import { useState } from 'react'
import './App.css'

type Page = 'landing' | 'volunteers' | 'managers'

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

          <form>
            <p>
              <label>
                First Name
                <br />
                <input type="text" name="first_name" />
              </label>
            </p>

            <p>
              <label>
                Last Name
                <br />
                <input type="text" name="last_name" />
              </label>
            </p>

            <p>
              <label>
                Email
                <br />
                <input type="email" name="email" />
              </label>
            </p>

            <p>
              <label>
                LinkedIn Profile URL
                <br />
                <input type="url" name="linkedin_url" />
              </label>
            </p>

            <button type="button">Save volunteer profile</button>
          </form>
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
