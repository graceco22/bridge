import { load } from 'https://deno.land/std@0.224.0/dotenv/mod.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

type SendOutreachRequest = {
  requestId?: string
  volunteerIds?: string[]
}

type DraftRow = {
  id: string
  email_subject: string
  email_body: string
  volunteer_id: string
  volunteers: {
    first_name: string
    last_name: string
    email: string
  } | null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

Deno.serve(async (req) => {
  await load({
    envPath: new URL('./.env.local', import.meta.url).pathname,
    export: true,
    allowEmptyValues: true,
  })

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing Supabase service credentials.' }, 500)
  }

  if (!resendApiKey || !resendFromEmail) {
    return jsonResponse(
      {
        error:
          'Missing RESEND_API_KEY or RESEND_FROM_EMAIL. Set both before sending real email.',
      },
      500,
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  let body: SendOutreachRequest
  try {
    body = (await req.json()) as SendOutreachRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const requestId = body.requestId?.trim()
  const volunteerIds = Array.from(new Set(body.volunteerIds ?? []))

  if (!requestId || volunteerIds.length === 0) {
    return jsonResponse({ error: 'requestId and volunteerIds are required.' }, 400)
  }

  const { data: requestRow, error: requestError } = await supabase
    .from('volunteer_requests')
    .select('id, request_text')
    .eq('id', requestId)
    .maybeSingle()

  if (requestError) {
    return jsonResponse({ error: requestError.message }, 500)
  }

  if (!requestRow) {
    return jsonResponse({ error: 'Request not found.' }, 404)
  }

  const { data: drafts, error: draftsError } = await supabase
    .from('outreach_messages')
    .select('id, email_subject, email_body, volunteer_id, volunteers(first_name, last_name, email)')
    .eq('request_id', requestId)
    .in('volunteer_id', volunteerIds)
    .eq('send_status', 'draft')

  if (draftsError) {
    return jsonResponse({ error: draftsError.message }, 500)
  }

  const draftRows = (drafts as DraftRow[] | null) ?? []
  if (draftRows.length === 0) {
    return jsonResponse({ error: 'No draft outreach messages found for the selected volunteers.' }, 404)
  }

  const successfulDraftIds: string[] = []
  const failures: Array<{ volunteerId: string; error: string }> = []

  for (const draft of draftRows) {
    const volunteerEmail = draft.volunteers?.email
    if (!volunteerEmail) {
      failures.push({ volunteerId: draft.volunteer_id, error: 'Missing volunteer email.' })
      continue
    }

    const sendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: [volunteerEmail],
        subject: draft.email_subject,
        text: draft.email_body,
      }),
    })

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text()
      failures.push({ volunteerId: draft.volunteer_id, error: errorText })
      continue
    }

    successfulDraftIds.push(draft.id)
  }

  if (successfulDraftIds.length > 0) {
    const { error: updateError } = await supabase
      .from('outreach_messages')
      .update({ send_status: 'sent', sent_at: new Date().toISOString() })
      .in('id', successfulDraftIds)

    if (updateError) {
      return jsonResponse({ error: updateError.message }, 500)
    }
  }

  const { count: remainingDraftCount, error: remainingDraftError } = await supabase
    .from('outreach_messages')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', requestId)
    .eq('send_status', 'draft')

  if (remainingDraftError) {
    return jsonResponse({ error: remainingDraftError.message }, 500)
  }

  const requestStatus = remainingDraftCount === 0 ? 'sent' : 'in_progress'

  const { error: requestUpdateError } = await supabase
    .from('volunteer_requests')
    .update({ status: requestStatus })
    .eq('id', requestId)

  if (requestUpdateError) {
    return jsonResponse({ error: requestUpdateError.message }, 500)
  }

  return jsonResponse({
    requestId,
    requestText: requestRow.request_text,
    sentCount: successfulDraftIds.length,
    failedCount: failures.length,
    failures,
    requestStatus,
  })
})