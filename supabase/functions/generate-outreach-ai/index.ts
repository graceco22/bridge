import { createClient } from 'npm:@supabase/supabase-js@2'

type VolunteerInput = {
  id: string
  first_name: string
  last_name: string
  email: string
  skills: string[]
  location: string | null
  availability: string | null
}

type GenerateOutreachRequest = {
  requestId?: string
  requestText?: string
  volunteers?: VolunteerInput[]
}

type GeneratedDraft = {
  volunteer_id: string
  email_subject: string
  email_body: string
  match_score: number
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STANDARD_SIGNOFF = 'Thank you,\nBridge Team'

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function withStandardSignoff(emailBody: string) {
  const trimmed = emailBody.trim()
  const withoutExistingClosing = trimmed.replace(
    /\n*(thanks|thank you|best|sincerely|regards)[\s\S]*$/i,
    '',
  )

  return `${withoutExistingClosing.trim()}\n\n${STANDARD_SIGNOFF}`
}

function fallbackDrafts(requestText: string, volunteers: VolunteerInput[]): GeneratedDraft[] {
  return volunteers.map((volunteer) => ({
    volunteer_id: volunteer.id,
    email_subject: `Volunteer opportunity: ${requestText.slice(0, 60)}`,
    email_body: withStandardSignoff(
      `Hi ${volunteer.first_name},\n\n` +
        `We think you could be a strong fit for this opportunity: "${requestText}".\n` +
        'Would you be open to helping?',
    ),
    match_score: 50,
  }))
}

function stripCodeFence(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  const withoutStart = trimmed.replace(/^```(?:json)?\s*/i, '')
  return withoutStart.replace(/\s*```$/, '').trim()
}

function normalizeGeneratedDrafts(
  requestText: string,
  volunteers: VolunteerInput[],
  drafts: GeneratedDraft[],
) {
  const byVolunteerId = new Map<string, GeneratedDraft>()

  for (const draft of drafts) {
    if (!draft || typeof draft.volunteer_id !== 'string') {
      continue
    }

    byVolunteerId.set(draft.volunteer_id, {
      volunteer_id: draft.volunteer_id,
      email_subject:
        typeof draft.email_subject === 'string' && draft.email_subject.trim()
          ? draft.email_subject.trim()
          : `Volunteer opportunity: ${requestText.slice(0, 60)}`,
      email_body:
        typeof draft.email_body === 'string' && draft.email_body.trim()
          ? withStandardSignoff(draft.email_body)
          : withStandardSignoff(`Hi,\n\nWe think you could be a fit for: "${requestText}".`),
      match_score:
        typeof draft.match_score === 'number' && Number.isFinite(draft.match_score)
          ? Math.max(0, Math.min(100, draft.match_score))
          : 50,
    })
  }

  return volunteers.map((volunteer) => {
    const maybeDraft = byVolunteerId.get(volunteer.id)
    if (maybeDraft) {
      return maybeDraft
    }

    return {
      volunteer_id: volunteer.id,
      email_subject: `Volunteer opportunity: ${requestText.slice(0, 60)}`,
      email_body:
        withStandardSignoff(
          `Hi ${volunteer.first_name},\n\n` +
            `We think you could be a strong fit for this opportunity: "${requestText}".\n` +
            'Would you be open to helping?',
        ),
      match_score: 50,
    }
  })
}

async function callGemini(
  geminiApiKey: string,
  requestText: string,
  volunteers: VolunteerInput[],
) {
  const prompt = [
    'You are helping a nonprofit coordinator write personalized outreach emails.',
    `Every email_body must end with exactly:\n${STANDARD_SIGNOFF}`,
    'Return ONLY valid JSON with this shape:',
    '{"drafts":[{"volunteer_id":"...","email_subject":"...","email_body":"...","match_score":0-100}]}',
    'Do not include markdown code fences.',
    '',
    `Volunteer request:\n${requestText}`,
    '',
    `Volunteers JSON:\n${JSON.stringify(volunteers)}`,
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
          temperature: 0.4,
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
  const parsed = JSON.parse(cleaned) as { drafts?: GeneratedDraft[] }
  if (!Array.isArray(parsed.drafts)) {
    throw new Error('Gemini output did not include drafts array.')
  }

  return normalizeGeneratedDrafts(requestText, volunteers, parsed.drafts)
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

  let body: GenerateOutreachRequest
  try {
    body = (await req.json()) as GenerateOutreachRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const requestId = body.requestId?.trim()
  const requestText = body.requestText?.trim()
  const volunteers = body.volunteers ?? []

  if (!requestId || !requestText || volunteers.length === 0) {
    return jsonResponse({ error: 'requestId, requestText, and volunteers are required.' }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  let generatedDrafts: GeneratedDraft[]
  let usedModel = 'fallback-template'
  let fallbackReason: string | undefined

  if (geminiApiKey) {
    try {
      generatedDrafts = await callGemini(geminiApiKey, requestText, volunteers)
      usedModel = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : 'Gemini request failed.'
      generatedDrafts = fallbackDrafts(requestText, volunteers)
    }
  } else {
    fallbackReason = 'Missing GEMINI_API_KEY.'
    generatedDrafts = fallbackDrafts(requestText, volunteers)
  }

  const outreachRows = generatedDrafts.map((draft) => ({
    request_id: requestId,
    volunteer_id: draft.volunteer_id,
    email_subject: draft.email_subject,
    email_body: draft.email_body,
    match_score: draft.match_score,
    send_status: 'draft',
  }))

  const { error: insertError } = await supabase.from('outreach_messages').insert(outreachRows)

  if (insertError) {
    return jsonResponse({ error: insertError.message }, 500)
  }

  return jsonResponse({
    requestId,
    generatedCount: generatedDrafts.length,
    drafts: generatedDrafts,
    usedModel,
    fallbackReason,
  })
})
