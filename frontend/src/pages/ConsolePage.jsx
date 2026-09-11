/** The queue — what an officer sees before choosing a file. */

import { useState } from 'react'
import Queue from '@/components/applications/Queue.jsx'
import { ErrorState, Skeleton } from '@/components/common/ui.jsx'
import { useBootedConsole } from '@/hooks/console'
import { boot } from '@/store/console'

export default function ConsolePage() {
  const state = useBootedConsole()
  const [filter, setFilter] = useState('ALL')

  if (state.boot === 'ERROR') {
    return (
      <ErrorState
        title="RECALLER runtime unavailable"
        body={state.bootError}
        onRetry={() => boot()}
      />
    )
  }

  if (state.boot !== 'READY') {
    return (
      <>
        <Skeleton lines={2} className="skel--head" />
        <Skeleton lines={6} className="skel--page" />
      </>
    )
  }

  return (
    <Queue
      applications={state.applications}
      policy={state.policy}
      filter={filter}
      onFilter={setFilter}
    />
  )
}
