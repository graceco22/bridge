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

const matchedPeople = [
  {
    name: 'Sarah Chen',
    skills: 'Logistics, food sorting',
    location: 'Vancouver',
    availability: 'Weekend mornings',
  },
  {
    name: 'Aisha Patel',
    skills: 'Design, social media',
    location: 'Burnaby',
    availability: 'Evenings',
  },
  {
    name: 'Daniel Kim',
    skills: 'Tutoring, mentoring',
    location: 'Richmond',
    availability: 'After 4 PM',
  },
]

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

  useEffect(() => {
    if (page === 'volunteers') {
      void loadRecentVolunteers()
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

          <form>
            <p>
              <label>
                Describe the volunteer need
                <br />
                <textarea
                  name="request"
                  rows={6}
                  defaultValue="We need 10 volunteers for a food drive next Saturday in Vancouver."
                />
              </label>
            </p>

            <button type="button">Generate matched people</button>
          </form>

          <h2>Matched People</h2>
          <ul>
            {matchedPeople.map((person) => (
              <li key={person.name}>
                <strong>{person.name}</strong> - {person.skills} - {person.location} -{' '}
                {person.availability}
              </li>
            ))}
          </ul>

          <h2>Draft Email</h2>
          <p>
            Hi Sarah, we saw your background in food security and your weekend
            availability. We would love to have you join our food drive this Saturday.
          </p>

          <button type="button">Send to all matched people</button>
        </section>
      )}
    </main>
  )
}

export default App
