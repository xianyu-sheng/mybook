import { z } from 'zod'
import { InvalidModelOutput } from './generate.js'

function json(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
}

const summarySchema = z.object({
  summary: z.string().trim().min(1),
  keyTopics: z.array(z.string().trim().min(1)),
  suggestedQuestions: z.array(z.string().trim().min(1)),
})

export function parseSourceSummary(text: string) {
  try { return summarySchema.parse(json(text)) }
  catch { throw new InvalidModelOutput('Source summary JSON is incomplete or invalid') }
}

const feedbackSchema = z.object({
  score: z.number().int().min(0).max(100),
  feedback: z.string().trim().min(1),
  reference_answer: z.string().trim().min(1),
  knowledge: z.string().trim().min(1),
  next_question: z.string().trim(),
})

export function parseInterviewFeedback(text: string, last: boolean) {
  try {
    const feedback = feedbackSchema.parse(json(text))
    if (last ? feedback.next_question !== '' : !feedback.next_question) throw new Error('Invalid next question')
    return feedback
  } catch { throw new InvalidModelOutput('Interview feedback JSON is incomplete or invalid') }
}
