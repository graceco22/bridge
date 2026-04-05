import { useEffect, useState } from 'react'
import './App.css'
import { supabase } from './lib/supabase'

type Page = 'landing' | 'volunteers' | 'managers'

type VolunteerFormData = {
  first_name: string
  last_name: string
  email: string
  linkedin_url: string
}

type VolunteerRecord = {
  id: string
  first_name: string
  last_name: string
  email: string
  linkedin_url: string
  created_at: string
}

type MatchedVolunteer = {
  id: string
  first_name: string
  last_name: string
  email: string
  skills: string[]
  location: string | null
  availability: string | null
}

type OutreachHistoryItem = {
  id: string
  email_subject: string
  send_status: string
  created_at: string
  volunteer: {
    first_name: string
    last_name: string
    email: string
  } | null
}

type ManagerRequestHistory = {
  id: string
  request_text: string
  status: string
  created_at: string
  outreach: OutreachHistoryItem[]
}

function App() {
  const [page, setPage] = useState<Page>('landing')
  const [volunteerForm, setVolunteerForm] = useState<VolunteerFormData>({
    first_name: '',
    last_name: '',
    email: '',
    linkedin_url: '',
  })
  const [isSubmittingVolunteer, setIsSubmittingVolunteer] = useState(false)
  const [volunteerSubmitMessage, setVolunteerSubmitMessage] = useState('')
  const [recentVolunteers, setRecentVolunteers] = useState<VolunteerRecord[]>([])
  const [isLoadingRecentVolunteers, setIsLoadingRecentVolunteers] = useState(false)
  const [recentVolunteersMessage, setRecentVolunteersMessage] = useState('')
  const [managerRequestText, setManagerRequestText] = useState(
    'We need 10 volunteers for a food drive next Saturday in Vancouver.',
  )
  const [isGeneratingMatches, setIsGeneratingMatches] = useState(false)
  const [managerMessage, setManagerMessage] = useState('')
  const [matchedVolunteers, setMatchedVolunteers] = useState<MatchedVolunteer[]>([])
  const [selectedVolunteerIds, setSelectedVolunteerIds] = useState<string[]>([])
  const [draftPreview, setDraftPreview] = useState('')
  const [lastGeneratedRequestId, setLastGeneratedRequestId] = useState<string | null>(
    null,
  )
  const [isSendingOutreach, setIsSendingOutreach] = useState(false)
  const [recentManagerRequests, setRecentManagerRequests] = useState<
    ManagerRequestHistory[]
  >([])
  const [isLoadingManagerHistory, setIsLoadingManagerHistory] = useState(false)
  const [managerHistoryMessage, setManagerHistoryMessage] = useState('')

  async function loadRecentVolunteers() {
    setIsLoadingRecentVolunteers(true)
    setRecentVolunteersMessage('')

    const { data, error } = await supabase
      .from('volunteers')
      .select('id, first_name, last_name, email, linkedin_url, created_at')
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) {
      setRecentVolunteersMessage(`Could not load volunteers: ${error.message}`)
      setIsLoadingRecentVolunteers(false)
      return
    }

    setRecentVolunteers((data as VolunteerRecord[]) ?? [])
    setIsLoadingRecentVolunteers(false)
  }

  async function loadManagerHistory() {
    setIsLoadingManagerHistory(true)
    setManagerHistoryMessage('')

    const { data, error } = await supabase
      .from('volunteer_requests')
      .select(
        'id, request_text, status, created_at, outreach_messages(id, email_subject, send_status, created_at, volunteers(first_name, last_name, email))',
      )
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) {
      setManagerHistoryMessage(`Could not load manager history: ${error.message}`)
      setIsLoadingManagerHistory(false)
      return
    }

    const mappedRequests: ManagerRequestHistory[] = ((data as any[]) ?? []).map(
      (request) => {
        const outreach = ((request.outreach_messages as any[]) ?? []).map((item) => {
          const volunteerData = Array.isArray(item.volunteers)
            ? item.volunteers[0] ?? null
            : item.volunteers ?? null

          return {
            id: item.id,
            email_subject: item.email_subject,
            send_status: item.send_status,
            created_at: item.created_at,
            volunteer: volunteerData,
          }
        })

        return {
          id: request.id,
          request_text: request.request_text,
          status: request.status,
          created_at: request.created_at,
          outreach,
        }
      },
    )

    setRecentManagerRequests(mappedRequests)
    setIsLoadingManagerHistory(false)
  }

  useEffect(() => {
    if (page === 'volunteers') {
      void loadRecentVolunteers()
    }

    if (page === 'managers') {
      void loadManagerHistory()
    }
  }, [page])

  async function handleVolunteerSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setVolunteerSubmitMessage('')
    setIsSubmittingVolunteer(true)

    const payload = {
      first_name: volunteerForm.first_name.trim(),
      last_name: volunteerForm.last_name.trim(),
      email: volunteerForm.email.trim().toLowerCase(),
      linkedin_url: volunteerForm.linkedin_url.trim(),
    }

    const { error } = await supabase.from('volunteers').insert(payload)

    if (error) {
      setVolunteerSubmitMessage(`Error: ${error.message}`)
      setIsSubmittingVolunteer(false)
      return
    }

    setVolunteerSubmitMessage('Success: volunteer profile saved.')
    setVolunteerForm({
      first_name: '',
      last_name: '',
      email: '',
      linkedin_url: '',
    })
    await loadRecentVolunteers()
    setIsSubmittingVolunteer(false)
  }

  function handleVolunteerFieldChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const { name, value } = event.target
    setVolunteerForm((previous) => ({
      ...previous,
      [name]: value,
    }))
  }

  async function handleManagerGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setManagerMessage('')
    setDraftPreview('')
    setIsGeneratingMatches(true)

    const trimmedRequest = managerRequestText.trim()
    if (!trimmedRequest) {
      setManagerMessage('Error: Please enter a request before generating matches.')
      setIsGeneratingMatches(false)
      return
    }

    const { data: requestData, error: requestError } = await supabase
      .from('volunteer_requests')
      .insert({ request_text: trimmedRequest })
      .select('id')
      .single()

    if (requestError || !requestData) {
      setManagerMessage(`Error saving request: ${requestError?.message ?? 'Unknown error'}`)
      setIsGeneratingMatches(false)
      return
    }

    setLastGeneratedRequestId(requestData.id)

    const { data: volunteersData, error: volunteersError } = await supabase
      .from('volunteers')
      .select('id, first_name, last_name, email, skills, location, availability')
      .order('created_at', { ascending: false })
      .limit(10)

    if (volunteersError) {
      setManagerMessage(`Error loading volunteers: ${volunteersError.message}`)
      setIsGeneratingMatches(false)
      return
    }

    const volunteers = (volunteersData as MatchedVolunteer[]) ?? []
    if (volunteers.length === 0) {
      setMatchedVolunteers([])
      setSelectedVolunteerIds([])
      setManagerMessage('Request saved, but there are no volunteers to match yet.')
      await loadManagerHistory()
      setIsGeneratingMatches(false)
      return
    }

    const outreachRows = volunteers.map((volunteer) => {
      return {
        request_id: requestData.id,
        volunteer_id: volunteer.id,
        email_subject: `Volunteer opportunity: ${trimmedRequest.slice(0, 60)}`,
        email_body:
          `Hi ${volunteer.first_name},\n\n` +
          `We think you could be a great fit for this opportunity: "${trimmedRequest}".\n` +
          `Would you be open to helping?\n\n` +
          'Thank you,\nNonprofit Team',
        match_score: 0,
        send_status: 'draft',
      }
    })

    const { error: outreachError } = await supabase
      .from('outreach_messages')
      .insert(outreachRows)

    if (outreachError) {
      setManagerMessage(`Request saved, but failed to create drafts: ${outreachError.message}`)
      await loadManagerHistory()
      setIsGeneratingMatches(false)
      return
    }

    setMatchedVolunteers(volunteers)
    setSelectedVolunteerIds(volunteers.map((volunteer) => volunteer.id))
    setDraftPreview(
      `Hi ${volunteers[0].first_name}, we think you are a strong match for: "${trimmedRequest}".`,
    )
    setManagerMessage(
      `Success: request saved and ${volunteers.length} outreach draft(s) created.`,
    )
    await loadManagerHistory()
    setIsGeneratingMatches(false)
  }

  function handleToggleSelectedVolunteer(volunteerId: string) {
    setSelectedVolunteerIds((previous) => {
      if (previous.includes(volunteerId)) {
        return previous.filter((id) => id !== volunteerId)
      }

      return [...previous, volunteerId]
    })
  }

  async function handleSendSelectedMatched() {
    setManagerMessage('')

    if (!lastGeneratedRequestId) {
      setManagerMessage('Error: Generate matches first before sending outreach.')
      return
    }

    if (selectedVolunteerIds.length === 0) {
      setManagerMessage('Error: Select at least one matched volunteer to send outreach.')
      return
    }

    setIsSendingOutreach(true)

    const { data, error } = await supabase.functions.invoke('send-outreach', {
      body: {
        requestId: lastGeneratedRequestId,
        volunteerIds: selectedVolunteerIds,
      },
    })

    if (error) {
      setManagerMessage(`Error sending outreach: ${error.message}`)
      setIsSendingOutreach(false)
      return
    }

    const sentCount = typeof data?.sentCount === 'number' ? data.sentCount : 0
    const failedCount = typeof data?.failedCount === 'number' ? data.failedCount : 0
    const failedVolunteerIds = Array.isArray(data?.failures)
      ? data.failures
          .map((failure: { volunteerId?: string }) => failure.volunteerId)
          .filter((volunteerId: string | undefined): volunteerId is string =>
            Boolean(volunteerId),
          )
      : []

    setManagerMessage(
      failedCount > 0
        ? `Sent ${sentCount} email(s). ${failedCount} failed; those are still selected so you can retry.`
        : `Success: sent ${sentCount} email(s) to selected volunteer(s).`,
    )
    setSelectedVolunteerIds(failedVolunteerIds)
    await loadManagerHistory()
    setIsSendingOutreach(false)
  }

  return (
    <main>
      <nav>
        <button type="button" onClick={() => setPage('landing')}>
          Landing
        </button>
        <button type="button" onClick={() => setPage('volunteers')}>
          Volunteer Profile
        </button>
        <button type="button" onClick={() => setPage('managers')}>
          Manager Console
        </button>
      </nav>

      {page === 'landing' && (
        <section>
          <h1>AI Volunteer Coordinator</h1>
          <p>
            This application helps nonprofits find volunteers, contact them with
            personalized emails, and manage responses in one place.
          </p>
          <p>
            Volunteers only provide first name, last name, email, and LinkedIn profile
            URL. The app uses the LinkedIn profile to pull the rest of the details.
            Managers type what they need in plain language, and the system matches
            people and prepares outreach.
          </p>
        </section>
      )}

      {page === 'volunteers' && (
        <section>
          <h1>Add Your LinkedIn Profile</h1>
          <p>
            Volunteers only need to enter the basics. Everything else should come from
            the LinkedIn profile.
          </p>

          <form onSubmit={handleVolunteerSubmit}>
            <p>
              <label>
                First Name
                <br />
                <input
                  type="text"
                  name="first_name"
                  value={volunteerForm.first_name}
                  onChange={handleVolunteerFieldChange}
                  required
                />
              </label>
            </p>

            <p>
              <label>
                Last Name
                <br />
                <input
                  type="text"
                  name="last_name"
                  value={volunteerForm.last_name}
                  onChange={handleVolunteerFieldChange}
                  required
                />
              </label>
            </p>

            <p>
              <label>
                Email
                <br />
                <input
                  type="email"
                  name="email"
                  value={volunteerForm.email}
                  onChange={handleVolunteerFieldChange}
                  required
                />
              </label>
            </p>

            <p>
              <label>
                LinkedIn Profile URL
                <br />
                <input
                  type="url"
                  name="linkedin_url"
                  value={volunteerForm.linkedin_url}
                  onChange={handleVolunteerFieldChange}
                  required
                />
              </label>
            </p>

            <button type="submit" disabled={isSubmittingVolunteer}>
              {isSubmittingVolunteer ? 'Saving...' : 'Save volunteer profile'}
            </button>

            {volunteerSubmitMessage && <p>{volunteerSubmitMessage}</p>}
          </form>

          <h2>Recent Volunteers (from database)</h2>
          {isLoadingRecentVolunteers && <p>Loading recent volunteers...</p>}
          {recentVolunteersMessage && <p>{recentVolunteersMessage}</p>}
          {!isLoadingRecentVolunteers && recentVolunteers.length === 0 && (
            <p>No volunteers yet.</p>
          )}
          {recentVolunteers.length > 0 && (
            <ul>
              {recentVolunteers.map((volunteer) => (
                <li key={volunteer.id}>
                  <strong>
                    {volunteer.first_name} {volunteer.last_name}
                  </strong>{' '}
                  - {volunteer.email} - {volunteer.linkedin_url}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {page === 'managers' && (
        <section>
          <h1>Manager Console</h1>
          <p>
            Managers type a request, the app generates a list of people to contact,
            drafts a personalized email for each person, and then sends to everyone
            in the list.
          </p>
          <p>
            The draft email should be personalized for each matched person before it
            is sent.
          </p>

          <form onSubmit={handleManagerGenerate}>
            <p>
              <label>
                Describe the volunteer need
                <br />
                <textarea
                  name="request"
                  rows={6}
                  value={managerRequestText}
                  onChange={(event) => setManagerRequestText(event.target.value)}
                />
              </label>
            </p>

            <button type="submit" disabled={isGeneratingMatches}>
              {isGeneratingMatches ? 'Generating...' : 'Generate matched people'}
            </button>

            {managerMessage && <p>{managerMessage}</p>}
          </form>

          <h2>Matched People</h2>
          <ul>
            {matchedVolunteers.map((person) => {
              const skillsText =
                person.skills.length > 0 ? person.skills.join(', ') : 'No skills parsed yet'
              return (
                <li key={person.id}>
                  <strong>
                    {person.first_name} {person.last_name}
                  </strong>{' '}
                  - {skillsText} - {person.location ?? 'No location'} -{' '}
                  {person.availability ?? 'No availability'}
                  <br />
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedVolunteerIds.includes(person.id)}
                      onChange={() => handleToggleSelectedVolunteer(person.id)}
                    />{' '}
                    Select for sending
                  </label>
                </li>
              )
            })}
          </ul>
          {matchedVolunteers.length === 0 && <p>No matches generated yet.</p>}

          <h2>Draft Email</h2>
          <p>{draftPreview || 'No draft generated yet.'}</p>

          <h2>Recent Manager Activity</h2>
          {isLoadingManagerHistory && <p>Loading manager history...</p>}
          {managerHistoryMessage && <p>{managerHistoryMessage}</p>}
          {!isLoadingManagerHistory && recentManagerRequests.length === 0 && (
            <p>No manager requests yet.</p>
          )}
          {recentManagerRequests.length > 0 && (
            <ul>
              {recentManagerRequests.map((request) => (
                <li key={request.id}>
                  <p>
                    <strong>Request:</strong> {request.request_text}
                  </p>
                  <p>
                    <strong>Status:</strong> {request.status} | <strong>Drafts:</strong>{' '}
                    {request.outreach.length}
                  </p>
                  {request.outreach.length > 0 && (
                    <ul>
                      {request.outreach.slice(0, 3).map((outreach) => {
                        const volunteerName = outreach.volunteer
                          ? `${outreach.volunteer.first_name} ${outreach.volunteer.last_name}`
                          : 'Unknown volunteer'

                        return (
                          <li key={outreach.id}>
                            {volunteerName} - {outreach.send_status} - {outreach.email_subject}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={handleSendSelectedMatched}
            disabled={
              isSendingOutreach ||
              !lastGeneratedRequestId ||
              selectedVolunteerIds.length === 0
            }
          >
            {isSendingOutreach ? 'Sending...' : 'Send to selected matched people'}
          </button>
        </section>
      )}
    </main>
  )
}

export default App
