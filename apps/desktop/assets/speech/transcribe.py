import argparse
import json
import os
import sys
import hashlib
from pathlib import Path
from urllib.request import urlopen, Request

# The Electron parent decodes stdout/stderr as UTF-8. On a Chinese Windows the
# default encoding for pipes is GBK, which garbles every emitted transcript.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Verified against the upstream SYSTRAN/faster-whisper-small checkpoint.
MODEL_FILES = {
    'config.json': 'b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828',
    'model.bin': '3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671',
    'tokenizer.json': 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab',
    'vocabulary.txt': '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913',
}
MODEL_SOURCES = [
    'https://huggingface.co/Systran/faster-whisper-small/resolve/main/',
    'https://modelscope.cn/models/pengzhendong/faster-whisper-small/resolve/64d190b68b8763d051c645fb876ee6d41e73637b/',
]


def digest(file):
    with open(file, 'rb') as stream:
        value = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
        return value.hexdigest()


def prepare_model(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for name, expected in MODEL_FILES.items():
        target = directory / name
        if target.exists() and digest(target) == expected:
            continue
        errors = []
        for source in MODEL_SOURCES:
            temp = directory / (name + '.partial')
            try:
                emit({'phase': 'download', 'message': f'下载 {name} · {"Hugging Face" if "huggingface" in source else "ModelScope"}'})
                with urlopen(Request(source + name, headers={'User-Agent': 'Mybook/0.4'}), timeout=25) as response, open(temp, 'wb') as stream:
                    total = int(response.headers.get('Content-Length', 0))
                    received, last = 0, -1
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        stream.write(chunk)
                        received += len(chunk)
                        percent = int(received * 100 / total) if total else received // (5 * 1024 * 1024)
                        if percent != last:
                            emit({'phase': 'download', 'message': f'{name} · {received // (1024 * 1024)} MB' + (f' / {total // (1024 * 1024)} MB' if total else '')})
                            last = percent
                if digest(temp) != expected:
                    raise ValueError('模型校验失败')
                os.replace(temp, target)
                break
            except Exception as error:
                errors.append(type(error).__name__)
                temp.unlink(missing_ok=True)
        else:
            raise RuntimeError(f'{name} 下载失败（已尝试两个来源：{", ".join(errors)}），已完成的文件保留，请重试')



def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--manifest')
    parser.add_argument('--language', default='zh')
    args = parser.parse_args()
    from faster_whisper import WhisperModel

    if args.prepare:
        prepare_model(args.model_dir)
        WhisperModel(args.model_dir, device='cpu', compute_type='int8', local_files_only=True)
        emit({'phase': 'ready'})
        return

    with open(args.manifest, encoding='utf-8') as file:
        tracks = json.load(file)
    model = WhisperModel(args.model_dir, device='cpu', compute_type='int8',
                         cpu_threads=min(8, os.cpu_count() or 4), local_files_only=True)
    language = None if args.language == 'auto' else args.language
    for index, track in enumerate(tracks):
        emit({'phase': 'track', 'track': track['kind'], 'index': index, 'total': len(tracks)})
        segments, info = model.transcribe(track['path'], language=language, beam_size=5,
                                          vad_filter=True, vad_parameters={'min_silence_duration_ms': 500},
                                          condition_on_previous_text=False)
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            emit({'phase': 'segment', 'track': track['kind'], 'start': segment.start,
                  'end': segment.end, 'text': text,
                  'percent': round(100 * (index + min(segment.end / max(info.duration, 1), 1)) / len(tracks))})
    emit({'phase': 'complete'})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
