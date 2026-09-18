import { HashRouter, Routes, Route } from 'react-router-dom'
import ErrorBoundary from '@/components/ErrorBoundary'
import AppShell from '@/components/layout/AppShell'
import NotebookListPage from '@/pages/NotebookListPage'
import NotebookPage from '@/pages/NotebookPage'
import SettingsPage from '@/pages/SettingsPage'
import RepositoriesPage from '@/pages/RepositoriesPage'
import RecordingsPage from '@/pages/RecordingsPage'
import PracticePage from '@/pages/PracticePage'

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<NotebookListPage />} />
            <Route path="/notebook/:id" element={<NotebookPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/repositories" element={<RepositoriesPage />} />
            <Route path="/recordings" element={<RecordingsPage />} />
            <Route path="/practice" element={<PracticePage />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  )
}
