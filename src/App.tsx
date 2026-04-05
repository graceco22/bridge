import { useEffect, useState } from 'react'
import * as mammoth from 'mammoth'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './App.css'
import { supabase } from './lib/supabase'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type Page = 'landing' | 'volunteers' | 'managers'

type VolunteerFormData = {
  first_name: string
  last_name: string
  email: string
}

type VolunteerRecord = {
  id: string
  first_name: string
  last_name: string
  email: string
  skills: string[]
  location: string | null
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

type SendFailure = {
  volunteerId: string
  error: string
}

type SendOutreachResult = {
  sentCount: number
  failedCount: number
  failures: SendFailure[]
}

type GeneratedDraft = {
  volunteer_id: string
  email_subject: string
  email_body: string
  match_score: number
}

type GenerateOutreachAiResult = {
  generatedCount: number
  drafts: GeneratedDraft[]
  usedModel: string
  fallbackReason?: string
}

type ParseResumeResult = {
  inferredSkills?: string[]
  inferredLocation?: string | null
  inferredAvailability?: string | null
  parseMethod?: 'gemini' | 'heuristic'
  fallbackReason?: string
}

function App() {
  const [page, setPage] = useState<Page>('landing')
  const [volunteerForm, setVolunteerForm] = useState<VolunteerFormData>({
    first_name: '',
    last_name: '',
    email: '',
  })
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [resumeInputKey, setResumeInputKey] = useState(0)
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
  const [lastSendFailures, setLastSendFailures] = useState<SendFailure[]>([])

  async function loadRecentVolunteers() {
    setIsLoadingRecentVolunteers(true)
    setRecentVolunteersMessage('')

    const { data, error } = await supabase
      .from('volunteers')
      .select('id, first_name, last_name, email, skills, location, created_at')
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
      // Keep compatibility with existing NOT NULL + UNIQUE schema until migration is applied.
      linkedin_url: `resume://${volunteerForm.email.trim().toLowerCase()}`,
    }

    if (!resumeFile) {
      setVolunteerSubmitMessage('Error: Please upload a resume file.')
      setIsSubmittingVolunteer(false)
      return
    }

    if (resumeFile.size > 5 * 1024 * 1024) {
      setVolunteerSubmitMessage('Error: Resume file is too large. Use a file under 5 MB.')
      setIsSubmittingVolunteer(false)
      return
    }

    const resumeText = (await extractResumeText(resumeFile)).trim()
    if (!resumeText) {
      setVolunteerSubmitMessage('Error: Resume file appears empty or unreadable.')
      setIsSubmittingVolunteer(false)
      return
    }

    const { data: insertedVolunteer, error: insertError } = await supabase
      .from('volunteers')
      .insert(payload)
      .select('id')
      .single()

    if (insertError || !insertedVolunteer) {
      setVolunteerSubmitMessage(`Error: ${insertError?.message ?? 'Could not save profile.'}`)
      setIsSubmittingVolunteer(false)
      return
    }

    const { data: enrichmentData, error: enrichmentError } =
      await supabase.functions.invoke('parse-resume', {
        body: {
          volunteerId: insertedVolunteer.id,
          resumeText,
          fileName: resumeFile.name,
        },
      })

    let enrichmentMessage = 'Resume parsing completed.'
    if (enrichmentError) {
      let detailedMessage = enrichmentError.message
      const context = (enrichmentError as { context?: Response }).context
      if (context) {
        try {
          const details = (await context.json()) as { error?: string }
          if (details.error) {
            detailedMessage = details.error
          }
        } catch {
          // Keep generic error message when no JSON body is available.
        }
      }
      enrichmentMessage = `Resume parsing failed: ${detailedMessage}`
    } else {
      const parsed = (enrichmentData as ParseResumeResult | null) ?? null
      const skillCount = parsed?.inferredSkills?.length ?? 0
      const locationText = parsed?.inferredLocation
        ? ` Location inferred: ${parsed.inferredLocation}.`
        : ''
      const availabilityText = parsed?.inferredAvailability
        ? ` Availability inferred: ${parsed.inferredAvailability}.`
        : ''
      const methodText = parsed?.parseMethod
        ? ` Method: ${parsed.parseMethod}.`
        : ''
      const fallbackText = parsed?.fallbackReason
        ? ` Fallback reason: ${parsed.fallbackReason}`
        : ''
      enrichmentMessage = `Resume parsing completed. Skills inferred: ${skillCount}.${locationText}${availabilityText}${methodText}${fallbackText}`
    }

    setVolunteerSubmitMessage(`Success: volunteer profile saved. ${enrichmentMessage}`)
    setVolunteerForm({
      first_name: '',
      last_name: '',
      email: '',
    })
    setResumeFile(null)
    setResumeInputKey((previous) => previous + 1)
    await loadRecentVolunteers()
    setIsSubmittingVolunteer(false)
  }

  async function extractResumeText(file: File) {
    const fileName = file.name.toLowerCase()

    if (fileName.endsWith('.pdf') || file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await getDocument({ data: arrayBuffer }).promise
      const pages: string[] = []

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber)
        const textContent = await page.getTextContent()
        const pageText = textContent.items
          .map((item) => {
            if ('str' in item && typeof item.str === 'string') {
              return item.str
            }

            return ''
          })
          .filter(Boolean)
          .join(' ')

        pages.push(pageText)
      }

      return pages.join('\n')
    }

    if (
      fileName.endsWith('.docx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const arrayBuffer = await file.arrayBuffer()
      const result = await mammoth.extractRawText({ arrayBuffer })
      return result.value
    }

    return file.text()
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

  function handleResumeFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setResumeFile(nextFile)
  }

  async function handleManagerGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setManagerMessage('')
    setLastSendFailures([])
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

    const { data: aiData, error: aiError } = await supabase.functions.invoke(
      'generate-outreach-ai',
      {
        body: {
          requestId: requestData.id,
          requestText: trimmedRequest,
          volunteers,
        },
      },
    )

    if (aiError) {
      let detailedMessage = aiError.message
      const context = (aiError as { context?: Response }).context
      if (context) {
        try {
          const details = (await context.json()) as { error?: string }
          if (details.error) {
            detailedMessage = details.error
          }
        } catch {
          // Keep generic message when no JSON body is available.
        }
      }

      setManagerMessage(
        `Request saved, but failed to generate AI drafts: ${detailedMessage}`,
      )
      await loadManagerHistory()
      setIsGeneratingMatches(false)
      return
    }

    const aiResult = (aiData as GenerateOutreachAiResult | null) ?? {
      generatedCount: 0,
      drafts: [],
      usedModel: 'fallback-template',
    }

    setMatchedVolunteers(volunteers)
    setSelectedVolunteerIds(volunteers.map((volunteer) => volunteer.id))
    const firstDraft = aiResult.drafts[0]
    setDraftPreview(firstDraft?.email_body ?? 'No draft generated yet.')
    setManagerMessage(
      `Success: request saved and ${aiResult.generatedCount} draft(s) created using ${aiResult.usedModel}.${aiResult.fallbackReason ? ` Fallback reason: ${aiResult.fallbackReason}` : ''}`,
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
    setLastSendFailures([])

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
      let detailedMessage = error.message
      const context = (error as { context?: Response }).context
      if (context) {
        try {
          const details = (await context.json()) as { error?: string }
          if (details.error) {
            detailedMessage = details.error
          }
        } catch {
          // Keep generic message when no JSON body is available.
        }
      }

      setManagerMessage(`Error sending outreach: ${detailedMessage}`)
      setIsSendingOutreach(false)
      return
    }

    const result = (data as SendOutreachResult | null) ?? {
      sentCount: 0,
      failedCount: 0,
      failures: [],
    }

    const failedVolunteerIds = result.failures.map((failure) => failure.volunteerId)

    setManagerMessage(
      result.failedCount > 0
        ? `Sent ${result.sentCount} email(s). ${result.failedCount} failed; those are still selected so you can retry.`
        : `Success: sent ${result.sentCount} email(s) to selected volunteer(s).`,
    )
    setLastSendFailures(result.failures)
    setSelectedVolunteerIds(failedVolunteerIds)
    await loadManagerHistory()
    setIsSendingOutreach(false)
  }

  function getVolunteerDisplayName(volunteerId: string) {
    const volunteer = matchedVolunteers.find((person) => person.id === volunteerId)
    if (!volunteer) {
      return volunteerId
    }

    return `${volunteer.first_name} ${volunteer.last_name}`
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
          <h1>Upload Your Resume</h1>
          <p>
            Volunteers enter the basics and upload a resume. The app parses the resume
            to infer skills, location, and availability.
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
                Resume File (.pdf, .docx, .txt)
                <br />
                <input
                  key={resumeInputKey}
                  type="file"
                  accept=".txt,.md,.rtf,.pdf,.docx"
                  onChange={handleResumeFileChange}
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
                  - {volunteer.email} - {volunteer.skills.join(', ') || 'No skills yet'} -{' '}
                  {volunteer.location ?? 'No location yet'}
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

          {lastSendFailures.length > 0 && (
            <>
              <h2>Send Failures</h2>
              <ul>
                {lastSendFailures.map((failure) => (
                  <li key={`${failure.volunteerId}-${failure.error}`}>
                    {getVolunteerDisplayName(failure.volunteerId)} - {failure.error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  )
}

export default App
