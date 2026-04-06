import { useState } from 'react'
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

type RawOutreachVolunteer =
  | {
      first_name: string
      last_name: string
      email: string
    }
  | {
      first_name: string
      last_name: string
      email: string
    }[]
  | null

type RawOutreachMessage = {
  id: string
  email_subject: string
  send_status: string
  created_at: string
  volunteers: RawOutreachVolunteer
}

type RawManagerRequest = {
  id: string
  request_text: string
  status: string
  created_at: string
  outreach_messages: RawOutreachMessage[] | null
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

const PAGE_LABELS: Record<Page, string> = {
  landing: 'Overview',
  volunteers: 'Volunteer Intake',
  managers: 'Manager Console',
}

const HIGHLIGHTS = [
  {
    value: '29,000',
    label: 'Nonprofit organizations across BC',
  },
  {
    value: '86,000',
    label: 'People employed in the sector',
  },
  {
    value: '$6.7B',
    label: 'Economic contribution to BC',
  },
]

const CAPABILITIES = [
  {
    title: 'Volunteer intake',
    description:
      'Collect name, email, and resume, then enrich the profile automatically.',
  },
  {
    title: 'Request capture',
    description:
      'Let program staff describe volunteer needs in plain language.',
  },
  {
    title: 'Outreach workflow',
    description:
      'Review matches, generate outreach, and track request activity in one place.',
  },
]

const STANDARD_SIGNOFF = 'Thank you,\nBridge Team'

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function withStandardSignoff(emailBody: string) {
  const trimmed = emailBody.trim()
  const withoutExistingClosing = trimmed.replace(
    /\n*(thanks|thank you|best|best regards|kind regards|sincerely|regards)[\s\S]*$/i,
    '',
  )

  return `${withoutExistingClosing.trim()}\n\n${STANDARD_SIGNOFF}`
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

    const mappedRequests: ManagerRequestHistory[] = ((data as RawManagerRequest[]) ?? []).map(
      (request) => {
        const outreach = (request.outreach_messages ?? []).map((item) => {
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

  function handlePageChange(nextPage: Page) {
    setPage(nextPage)

    if (nextPage === 'volunteers') {
      void loadRecentVolunteers()
    }

    if (nextPage === 'managers') {
      void loadManagerHistory()
    }
  }

  async function handleVolunteerSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setVolunteerSubmitMessage('')
    setIsSubmittingVolunteer(true)

    const payload = {
      first_name: volunteerForm.first_name.trim(),
      last_name: volunteerForm.last_name.trim(),
      email: volunteerForm.email.trim().toLowerCase(),
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
      .upsert(payload, { onConflict: 'email' })
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
      const methodText = parsed?.parseMethod ? ` Method: ${parsed.parseMethod}.` : ''
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

  function handleVolunteerFieldChange(event: React.ChangeEvent<HTMLInputElement>) {
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
    setDraftPreview(
      firstDraft?.email_body
        ? withStandardSignoff(firstDraft.email_body)
        : 'No draft generated yet.',
    )
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

  const selectedCount = selectedVolunteerIds.length

  return (
    <main className="app-shell">
      <div className="app-backdrop" />

      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-logo-wrap" aria-hidden="true">
            <img src="/SAP_2011_logo.svg.png" alt="SAP logo" className="brand-logo" />
          </div>
          <div>
            <p className="eyebrow">Strengthening BC&apos;s Nonprofit Workforce</p>
            <h1 className="brand-title">Bridge</h1>
          </div>
        </div>

        <nav className="page-nav" aria-label="Primary">
          {(Object.keys(PAGE_LABELS) as Page[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`nav-button ${page === key ? 'is-active' : ''}`}
              onClick={() => handlePageChange(key)}
            >
              {PAGE_LABELS[key]}
            </button>
          ))}
        </nav>
      </header>

      {page === 'landing' && (
        <section className="page page-landing">
          <section className="hero-card hero-card-clean">
            <div className="hero-copy">
              <p className="eyebrow">Overview</p>
              <h2>Volunteer coordination for BC nonprofits.</h2>
              <p className="hero-description">
                Bridge gives nonprofit teams a simple workflow for intake, matching,
                and outreach. The focus is operational clarity: fewer fields, fewer
                steps, and a workspace that stays understandable for non-technical staff.
              </p>
            </div>

            <div className="hero-actions hero-actions-compact">
              <button
                type="button"
                className="button button-primary"
                onClick={() => handlePageChange('managers')}
              >
                Open manager console
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => handlePageChange('volunteers')}
              >
                Review volunteer intake
              </button>
            </div>
          </section>

          <section className="surface-card">
            <div className="stats-strip">
              {HIGHLIGHTS.map((item) => (
                <div key={item.label} className="stats-strip-item">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="surface-card">
            <div className="overview-grid">
              <div className="overview-block">
                <div className="section-heading">
                  <p className="eyebrow">Core functions</p>
                  <h3>What the product does</h3>
                </div>
                <div className="compact-list">
                  {CAPABILITIES.map((item) => (
                    <article key={item.title} className="compact-item">
                      <h4>{item.title}</h4>
                      <p>{item.description}</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="overview-block">
                <div className="section-heading">
                  <p className="eyebrow">Design principles</p>
                  <h3>Why it fits the case</h3>
                </div>
                <div className="compact-list">
                  <article className="compact-item">
                    <h4>Minimal setup</h4>
                    <p>Volunteers and staff only provide what is necessary to move work forward.</p>
                  </article>
                  <article className="compact-item">
                    <h4>Accessible by default</h4>
                    <p>Clear labels, steady spacing, and direct actions reduce friction on older devices.</p>
                  </article>
                  <article className="compact-item">
                    <h4>Visible follow-through</h4>
                    <p>Requests, draft outreach, and send outcomes remain in one workspace.</p>
                  </article>
                </div>
              </div>
            </div>
          </section>
        </section>
      )}

      {page === 'volunteers' && (
        <section className="page page-detail">
          <div className="page-intro page-intro-simple">
            <div>
              <p className="eyebrow">Volunteer experience</p>
              <h2>Share your information in a few quick steps.</h2>
              <p>
                Enter your name and email, then upload your resume to create your
                profile. Bridge uses that information to help the nonprofit understand
                your skills, location, and availability without making you fill out a
                longer form.
              </p>
            </div>
            <p className="page-meta">Supports PDF, DOCX, TXT and files under 5 MB.</p>
          </div>

          <div className="content-grid content-grid-wide">
            <section className="surface-card">
              <div className="section-heading">
                <h3>Create volunteer profile</h3>
                <p>Keep the form lightweight and readable for first-time users.</p>
              </div>

              <form className="form-grid" onSubmit={handleVolunteerSubmit}>
                <label className="field">
                  <span>First name</span>
                  <input
                    type="text"
                    name="first_name"
                    value={volunteerForm.first_name}
                    onChange={handleVolunteerFieldChange}
                    required
                  />
                </label>

                <label className="field">
                  <span>Last name</span>
                  <input
                    type="text"
                    name="last_name"
                    value={volunteerForm.last_name}
                    onChange={handleVolunteerFieldChange}
                    required
                  />
                </label>

                <label className="field field-full">
                  <span>Email</span>
                  <input
                    type="email"
                    name="email"
                    value={volunteerForm.email}
                    onChange={handleVolunteerFieldChange}
                    required
                  />
                </label>

                <label className="field field-full">
                  <span>Resume file</span>
                  <input
                    key={resumeInputKey}
                    type="file"
                    accept=".txt,.md,.rtf,.pdf,.docx"
                    onChange={handleResumeFileChange}
                    required
                  />
                  <small>Accepted: .pdf, .docx, .txt, .md, .rtf</small>
                </label>

                <div className="form-footer field-full">
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={isSubmittingVolunteer}
                  >
                    {isSubmittingVolunteer ? 'Saving profile...' : 'Save volunteer profile'}
                  </button>

                  {volunteerSubmitMessage && (
                    <p
                      className={`status-message ${
                        volunteerSubmitMessage.startsWith('Success')
                          ? 'is-success'
                          : 'is-error'
                      }`}
                    >
                      {volunteerSubmitMessage}
                    </p>
                  )}
                </div>
              </form>
            </section>

            <aside className="surface-card">
              <div className="section-heading">
                <h3>Recent volunteer records</h3>
                <p>Latest profiles saved to the database.</p>
              </div>

              {isLoadingRecentVolunteers && (
                <p className="empty-state">Loading recent volunteers...</p>
              )}
              {recentVolunteersMessage && (
                <p className="status-message is-error">{recentVolunteersMessage}</p>
              )}
              {!isLoadingRecentVolunteers && recentVolunteers.length === 0 && (
                <p className="empty-state">No volunteers yet.</p>
              )}

              <div className="stack-list">
                {recentVolunteers.map((volunteer) => (
                  <article key={volunteer.id} className="record-card">
                    <div className="record-header">
                      <div>
                        <h4>
                          {volunteer.first_name} {volunteer.last_name}
                        </h4>
                        <p>{volunteer.email}</p>
                      </div>
                      <span className="record-time">
                        {formatDateTime(volunteer.created_at)}
                      </span>
                    </div>
                    <div className="pill-row">
                      {(volunteer.skills.length > 0
                        ? volunteer.skills
                        : ['No skills parsed yet']
                      ).map((skill) => (
                        <span key={`${volunteer.id}-${skill}`} className="pill">
                          {skill}
                        </span>
                      ))}
                    </div>
                    <p className="record-meta">
                      <strong>Location:</strong> {volunteer.location ?? 'Not inferred yet'}
                    </p>
                  </article>
                ))}
              </div>
            </aside>
          </div>
        </section>
      )}

      {page === 'managers' && (
        <section className="page page-detail">
          <div className="page-intro page-intro-simple">
            <div>
              <p className="eyebrow">Coordinator workspace</p>
              <h2>Find and contact the right volunteers.</h2>
              <p>
                Describe the support you need, review matched volunteers, and send
                outreach from one place. Bridge keeps the process simple so you can
                move quickly from request to contact.
              </p>
            </div>
            <p className="page-meta">{selectedCount} volunteer(s) currently selected.</p>
          </div>

          <div className="manager-layout">
            <div className="manager-main">
              <section className="surface-card">
                <div className="section-heading">
                  <h3>Describe the volunteer need</h3>
                  <p>Use plain language. The system handles matching and draft creation.</p>
                </div>

                <form className="request-form" onSubmit={handleManagerGenerate}>
                  <label className="field field-full">
                    <span>Volunteer request</span>
                    <textarea
                      name="request"
                      rows={6}
                      value={managerRequestText}
                      onChange={(event) => setManagerRequestText(event.target.value)}
                    />
                  </label>

                  <div className="form-footer">
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={isGeneratingMatches}
                    >
                      {isGeneratingMatches
                        ? 'Generating matches...'
                        : 'Generate matched people'}
                    </button>

                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={handleSendSelectedMatched}
                      disabled={
                        isSendingOutreach ||
                        !lastGeneratedRequestId ||
                        selectedVolunteerIds.length === 0
                      }
                    >
                      {isSendingOutreach
                        ? 'Sending outreach...'
                        : 'Send to selected people'}
                    </button>
                  </div>

                  {managerMessage && (
                    <p
                      className={`status-message ${
                        managerMessage.startsWith('Success') || managerMessage.startsWith('Sent')
                          ? 'is-success'
                          : 'is-error'
                      }`}
                    >
                      {managerMessage}
                    </p>
                  )}
                </form>
              </section>

              <section className="surface-card">
                <div className="section-heading section-heading-inline">
                  <div>
                    <h3>Matched people</h3>
                    <p>Review skills, availability, and outreach selection before sending.</p>
                  </div>
                  <span className="selection-chip">{selectedCount} selected</span>
                </div>

                {matchedVolunteers.length === 0 && (
                  <p className="empty-state">No matches generated yet.</p>
                )}

                <div className="stack-list">
                  {matchedVolunteers.map((person) => {
                    const skillsText =
                      person.skills.length > 0 ? person.skills : ['No skills parsed yet']

                    return (
                      <article key={person.id} className="record-card">
                        <div className="record-header">
                          <div>
                            <h4>
                              {person.first_name} {person.last_name}
                            </h4>
                            <p>{person.email}</p>
                          </div>
                          <label className="select-toggle">
                            <input
                              type="checkbox"
                              checked={selectedVolunteerIds.includes(person.id)}
                              onChange={() => handleToggleSelectedVolunteer(person.id)}
                            />
                            <span>Select</span>
                          </label>
                        </div>

                        <div className="pill-row">
                          {skillsText.map((skill) => (
                            <span key={`${person.id}-${skill}`} className="pill">
                              {skill}
                            </span>
                          ))}
                        </div>

                        <p className="record-meta">
                          <strong>Location:</strong> {person.location ?? 'Not available'}
                        </p>
                        <p className="record-meta">
                          <strong>Availability:</strong>{' '}
                          {person.availability ?? 'Not available'}
                        </p>
                      </article>
                    )
                  })}
                </div>
              </section>
            </div>

            <aside className="manager-sidebar">
              <section className="surface-card">
                <div className="section-heading">
                  <h3>Draft email preview</h3>
                  <p>Use this as the review baseline before outreach is sent.</p>
                </div>
                <div className="draft-card">
                  <pre>{draftPreview || 'No draft generated yet.'}</pre>
                </div>
              </section>

              <section className="surface-card">
                <div className="section-heading">
                  <h3>Recent manager activity</h3>
                  <p>Recent requests and the outreach generated for them.</p>
                </div>

                {isLoadingManagerHistory && (
                  <p className="empty-state">Loading manager history...</p>
                )}
                {managerHistoryMessage && (
                  <p className="status-message is-error">{managerHistoryMessage}</p>
                )}
                {!isLoadingManagerHistory && recentManagerRequests.length === 0 && (
                  <p className="empty-state">No manager requests yet.</p>
                )}

                <div className="stack-list">
                  {recentManagerRequests.map((request) => (
                    <article key={request.id} className="history-card">
                      <div className="record-header">
                        <h4>{request.request_text}</h4>
                        <span className="record-time">
                          {formatDateTime(request.created_at)}
                        </span>
                      </div>
                      <div className="history-meta">
                        <span className="status-pill">{request.status}</span>
                        <span>{request.outreach.length} draft(s)</span>
                      </div>
                      {request.outreach.length > 0 && (
                        <div className="history-list">
                          {request.outreach.slice(0, 3).map((outreach) => {
                            const volunteerName = outreach.volunteer
                              ? `${outreach.volunteer.first_name} ${outreach.volunteer.last_name}`
                              : 'Unknown volunteer'

                            return (
                              <div key={outreach.id} className="history-list-item">
                                <strong>{volunteerName}</strong>
                                <span>{outreach.send_status}</span>
                                <p>{outreach.email_subject}</p>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>

              {lastSendFailures.length > 0 && (
                <section className="surface-card">
                  <div className="section-heading">
                    <h3>Send failures</h3>
                    <p>These recipients remain selected so the coordinator can retry.</p>
                  </div>
                  <div className="stack-list">
                    {lastSendFailures.map((failure) => (
                      <article
                        key={`${failure.volunteerId}-${failure.error}`}
                        className="failure-card"
                      >
                        <h4>{getVolunteerDisplayName(failure.volunteerId)}</h4>
                        <p>{failure.error}</p>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </div>
        </section>
      )}
    </main>
  )
}

export default App
