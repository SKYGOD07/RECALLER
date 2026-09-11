import { useEffect } from 'react'
import ConsoleShell from '@/components/layout/ConsoleShell.jsx'
import { useBootedConsole } from '@/hooks/console'
import { RouterProvider, useRoute } from '@/lib/router'
import ApplicationPage from '@/pages/ApplicationPage.jsx'
import ConsolePage from '@/pages/ConsolePage.jsx'
import LandingPage from '@/pages/LandingPage.jsx'
import { selectApplication } from '@/store/console'
import '@/styles/console.css'

function Console({ route }) {
  const state = useBootedConsole()
  const application = route.id ? selectApplication(state, route.id) : null

  useEffect(() => {
    document.title = application
      ? `${application.id} · ${application.borrower_name} — RECALLER`
      : 'RECALLER Console'
  }, [application])

  return (
    <ConsoleShell state={state} application={application}>
      {route.view === 'application' ? (
        <ApplicationPage id={route.id} tab={route.tab} />
      ) : (
        <ConsolePage />
      )}
    </ConsoleShell>
  )
}

function Routes() {
  const { route } = useRoute()

  useEffect(() => {
    document.body.dataset.mode = route.view === 'landing' ? 'landing' : 'console'
  }, [route.view])

  if (route.view === 'landing') return <LandingPage />
  return <Console route={route} />
}

export default function App() {
  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  )
}
