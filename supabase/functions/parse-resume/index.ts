import { createClient } from 'npm:@supabase/supabase-js@2'

type ParseResumeRequest = {
  volunteerId?: string
  resumeText?: string
  fileName?: string
}

type ParsedResumeResult = {
  inferredSkills: string[]
  inferredInterests: string[]
  inferredLocation: string | null
  inferredLanguages: string[]
  inferredAvailability: string | null
  parseMethod: 'gemini' | 'heuristic'
  fallbackReason?: string
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

const languageCandidates = [
  'English',
  'French',
  'Spanish',
  'Mandarin',
  'Cantonese',
  'Hindi',
  'Punjabi',
  'Arabic',
  'Tagalog',
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
  food: 'Food Security',
  community: 'Community Outreach',
}

const interestKeywordMap: Record<string, string> = {
  climate: 'Climate',
  youth: 'Youth Programs',
  food: 'Food Security',
  education: 'Education',
  homeless: 'Homelessness Support',
  seniors: 'Seniors Support',
  health: 'Community Health',
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

function inferInterests(rawText: string) {
  const lowered = rawText.toLowerCase()
  const inferred = new Set<string>()

  for (const [keyword, label] of Object.entries(interestKeywordMap)) {
    if (lowered.includes(keyword)) {
      inferred.add(label)
    }
  }

  return Array.from(inferred)
}

function inferLocation(rawText: string) {
  const lowered = rawText.toLowerCase()
  for (const location of locationCandidates) {
    if (lowered.includes(location.toLowerCase())) {
      return location
    }
  }

  return null
}

function inferLanguages(rawText: string) {
  const lowered = rawText.toLowerCase()
  const inferred = new Set<string>()

  for (const language of languageCandidates) {
    if (lowered.includes(language.toLowerCase())) {
      inferred.add(language)
    }
  }

  return Array.from(inferred)
}

function inferAvailability(rawText: string) {
  const lowered = rawText.toLowerCase()

  if (lowered.includes('weekend')) {
    return 'Weekends'
  }

  if (lowered.includes('evening')) {
    return 'Evenings'
  }

  if (lowered.includes('morning')) {
    return 'Mornings'
  }

  if (lowered.includes('part-time') || lowered.includes('part time')) {
    return 'Part-time'
  }

  return null
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }

  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }

    const trimmed = value.trim()
    if (trimmed) {
      seen.add(trimmed)
    }
  }

  return Array.from(seen)
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function stripCodeFence(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  const withoutStart = trimmed.replace(/^```(?:json)?\s*/i, '')
  return withoutStart.replace(/\s*```$/, '').trim()
}

function parseWithHeuristics(resumeText: string): ParsedResumeResult {
  return {
    inferredSkills: inferSkills(resumeText),
    inferredInterests: inferInterests(resumeText),
    inferredLocation: inferLocation(resumeText),
    inferredLanguages: inferLanguages(resumeText),
    inferredAvailability: inferAvailability(resumeText),
    parseMethod: 'heuristic',
  }
}

async function parseWithGemini(
  geminiApiKey: string,
  resumeText: string,
): Promise<ParsedResumeResult> {
  const prompt = [
    'You are extracting structured volunteer profile data from a resume.',
    'Return ONLY valid JSON. No markdown. No code fences.',
    'Use this schema exactly:',
    '{"inferredSkills":string[],"inferredInterests":string[],"inferredLocation":string|null,"inferredLanguages":string[],"inferredAvailability":string|null}',
    '',
    'Rules:',
    '- Keep arrays concise and high-signal.',
    '- inferredLocation should be a city or region if present, otherwise null.',
    '- inferredAvailability examples: Weekends, Evenings, Mornings, Part-time, or null.',
    '',
    `Resume text:\n${resumeText}`,
  ].join('\n')

  const modelName = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error: ${errorText}`)
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }

  const outputText =
    payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''

  if (!outputText.trim()) {
    throw new Error('Gemini returned empty output.')
  }

  const cleaned = stripCodeFence(outputText)
  const parsed = JSON.parse(cleaned) as Record<string, unknown>

  return {
    inferredSkills: uniqueStrings(parsed.inferredSkills),
    inferredInterests: uniqueStrings(parsed.inferredInterests),
    inferredLocation: normalizeNullableString(parsed.inferredLocation),
    inferredLanguages: uniqueStrings(parsed.inferredLanguages),
    inferredAvailability: normalizeNullableString(parsed.inferredAvailability),
    parseMethod: 'gemini',
  }
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
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing Supabase service credentials.' }, 500)
  }

  let body: ParseResumeRequest
  try {
    body = (await req.json()) as ParseResumeRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const volunteerId = body.volunteerId?.trim()
  const resumeText = body.resumeText?.trim()
  const fileName = body.fileName?.trim() || 'resume'

  if (!volunteerId || !resumeText) {
    return jsonResponse({ error: 'volunteerId and resumeText are required.' }, 400)
  }

  const truncatedText = resumeText.slice(0, 15000)
  let parsedResult: ParsedResumeResult

  if (geminiApiKey) {
    try {
      parsedResult = await parseWithGemini(geminiApiKey, truncatedText)
    } catch (error) {
      parsedResult = {
        ...parseWithHeuristics(truncatedText),
        fallbackReason:
          error instanceof Error ? error.message : 'Gemini resume parsing failed.',
      }
    }
  } else {
    parsedResult = {
      ...parseWithHeuristics(truncatedText),
      fallbackReason: 'Missing GEMINI_API_KEY.',
    }
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const rawTextHeader = `Resume file: ${fileName}`

  const { error: updateError } = await supabase
    .from('volunteers')
    .update({
      linkedin_raw_text: `${rawTextHeader}\n\n${truncatedText}`,
      skills: parsedResult.inferredSkills,
      interests: parsedResult.inferredInterests,
      location: parsedResult.inferredLocation,
      languages: parsedResult.inferredLanguages,
      availability: parsedResult.inferredAvailability,
    })
    .eq('id', volunteerId)

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500)
  }

  return jsonResponse({
    volunteerId,
    inferredSkills: parsedResult.inferredSkills,
    inferredInterests: parsedResult.inferredInterests,
    inferredLocation: parsedResult.inferredLocation,
    inferredLanguages: parsedResult.inferredLanguages,
    inferredAvailability: parsedResult.inferredAvailability,
    parseMethod: parsedResult.parseMethod,
    fallbackReason: parsedResult.fallbackReason,
  })
})