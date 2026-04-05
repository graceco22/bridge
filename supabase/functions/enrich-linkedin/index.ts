import { createClient } from 'npm:@supabase/supabase-js@2'

type EnrichLinkedInRequest = {
  volunteerId?: string
  linkedinUrl?: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const locationCandidates = [
  'Vancouver',
  'Burnaby',
  'Richmond',
  'Surrey',
  'Toronto',
  'Calgary',
  'Montreal',
  'Seattle',
  'New York',
  'San Francisco',
]

const skillKeywordMap: Record<string, string> = {
  logistics: 'Logistics',
  tutor: 'Tutoring',
  mentor: 'Mentoring',
  teaching: 'Teaching',
  fundraising: 'Fundraising',
  design: 'Design',
  marketing: 'Marketing',
  social: 'Social Media',
  writing: 'Writing',
  developer: 'Software Development',
  engineer: 'Engineering',
  data: 'Data Analysis',
  project: 'Project Management',
  operations: 'Operations',
  healthcare: 'Healthcare',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function normalizeLinkedInUrl(input: string) {
  const trimmed = input.trim()
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }

  return `https://${trimmed}`
}

function extractTitle(html: string) {
  const match = html.match(/<title>(.*?)<\/title>/is)
  if (!match) {
    return ''
  }

  return match[1].replace(/\s+/g, ' ').trim()
}

function extractMetaDescription(html: string) {
  const doubleQuoteMatch = html.match(
    /<meta\s+name="description"\s+content="([^"]*)"\s*\/?>/i,
  )
  if (doubleQuoteMatch) {
    return doubleQuoteMatch[1].trim()
  }

  const singleQuoteMatch = html.match(
    /<meta\s+name='description'\s+content='([^']*)'\s*\/?>/i,
  )
  if (singleQuoteMatch) {
    return singleQuoteMatch[1].trim()
  }

  return ''
}

function inferSkills(rawText: string) {
  const lowered = rawText.toLowerCase()
  const inferred = new Set<string>()

  for (const [keyword, label] of Object.entries(skillKeywordMap)) {
    if (lowered.includes(keyword)) {
      inferred.add(label)
    }
  }

  return Array.from(inferred)
}

function inferLocation(rawText: string) {
  for (const candidate of locationCandidates) {
    if (rawText.toLowerCase().includes(candidate.toLowerCase())) {
      return candidate
    }
  }

  return null
}

function extractRawTextFromScraperPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const candidate = payload as Record<string, unknown>
  const parts: string[] = []

  const stringFields = [
    'full_name',
    'headline',
    'summary',
    'about',
    'city',
    'state',
    'country',
    'occupation',
  ]

  for (const field of stringFields) {
    const value = candidate[field]
    if (typeof value === 'string' && value.trim()) {
      parts.push(value.trim())
    }
  }

  const skills = candidate.skills
  if (Array.isArray(skills)) {
    for (const skill of skills) {
      if (typeof skill === 'string' && skill.trim()) {
        parts.push(skill.trim())
      }
    }
  }

  const experiences = candidate.experiences
  if (Array.isArray(experiences)) {
    for (const exp of experiences.slice(0, 5)) {
      if (exp && typeof exp === 'object') {
        const item = exp as Record<string, unknown>
        if (typeof item.title === 'string' && item.title.trim()) {
          parts.push(item.title.trim())
        }
        if (typeof item.company === 'string' && item.company.trim()) {
          parts.push(item.company.trim())
        }
        if (typeof item.description === 'string' && item.description.trim()) {
          parts.push(item.description.trim())
        }
      }
    }
  }

  return parts.join(' | ').trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const scraperEndpoint = Deno.env.get('LINKEDIN_SCRAPER_ENDPOINT')
  const scraperApiKey = Deno.env.get('LINKEDIN_SCRAPER_API_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing Supabase service credentials.' }, 500)
  }

  let body: EnrichLinkedInRequest
  try {
    body = (await req.json()) as EnrichLinkedInRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const volunteerId = body.volunteerId?.trim()
  const linkedinUrl = body.linkedinUrl?.trim()

  if (!volunteerId || !linkedinUrl) {
    return jsonResponse({ error: 'volunteerId and linkedinUrl are required.' }, 400)
  }

  const normalizedUrl = normalizeLinkedInUrl(linkedinUrl)

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  let rawText = ''

  // First try a configured scraper API provider, then fall back to best-effort page metadata.
  if (scraperEndpoint) {
    try {
      const scraperHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (scraperApiKey) {
        scraperHeaders.Authorization = `Bearer ${scraperApiKey}`
        scraperHeaders['x-api-key'] = scraperApiKey
      }

      const scraperResponse = await fetch(scraperEndpoint, {
        method: 'POST',
        headers: scraperHeaders,
        body: JSON.stringify({
          linkedin_url: normalizedUrl,
          url: normalizedUrl,
        }),
      })

      if (scraperResponse.ok) {
        const payload = (await scraperResponse.json()) as unknown
        rawText = extractRawTextFromScraperPayload(payload)
      }
    } catch {
      // Continue to fallback scraping.
    }
  }

  try {
    if (!rawText) {
      const profileResponse = await fetch(normalizedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
      })

      if (profileResponse.ok) {
        const html = await profileResponse.text()
        const title = extractTitle(html)
        const description = extractMetaDescription(html)
        rawText = [title, description].filter(Boolean).join(' | ').trim()
      }
    }
  } catch {
    // Keep enrichment best-effort. We still save normalized URL and fallback values.
  }

  if (!rawText) {
    rawText = `LinkedIn URL captured: ${normalizedUrl}`
  }

  const inferredSkills = inferSkills(rawText)
  const inferredLocation = inferLocation(rawText)

  const { error: updateError } = await supabase
    .from('volunteers')
    .update({
      linkedin_url: normalizedUrl,
      linkedin_raw_text: rawText,
      skills: inferredSkills,
      location: inferredLocation,
    })
    .eq('id', volunteerId)

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500)
  }

  return jsonResponse({
    volunteerId,
    linkedinUrl: normalizedUrl,
    linkedinRawText: rawText,
    inferredSkills,
    inferredLocation,
  })
})