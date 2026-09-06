/**
 * Demo content for chat.
 *
 * Six channels and a conversation in each, so the transcript, the unread counts, the thread view and
 * the sidebar sections all have something to draw.
 *
 * Every message is written by the one account this workspace has — whoever asked for the demo. A
 * conversation between several people would read better and would need invented user ids, which
 * resolve to nothing: avatars fall back to a grey circle and every name in the transcript reads
 * "Unknown". A believable-looking transcript full of ghosts is worse than an honest monologue, so
 * the channels are seeded as a workspace where one person has been writing things down.
 */
import type { DemoSeedContext, DemoSeedSummary } from '@kernhq/kernel'
import { and, eq } from 'drizzle-orm'
import { textToDoc } from './rich.js'
import { channels, messages as messagesTable } from './schema.js'
import { chatServices } from './services/index.js'

interface ChannelSeed {
  name: string
  topic: string
  purpose: string
  type: 'public' | 'private'
  messages: string[]
  /** messages posted as replies to the first message above */
  thread?: string[]
}

const CHANNELS: ChannelSeed[] = [
  {
    name: 'general',
    topic: 'Everything that concerns everybody',
    purpose: 'Announcements and anything that does not have a better home.',
    type: 'public',
    messages: [
      'Welcome. This channel is for things everybody needs to see — anything narrower belongs somewhere else.',
      'Office closed on Friday for the building work. Working from home for everyone that day.',
      'New starter next Monday in support. Say hello when you see the name appear.',
      'Reminder that the handbook is in Quire, and it is the place to fix something rather than complain about it.',
    ],
  },
  {
    name: 'engineering',
    topic: 'Builds, reviews, and whatever is on fire',
    purpose: 'Day-to-day engineering. Incidents get their own channel.',
    type: 'public',
    messages: [
      'Offline mode is behind a flag on the mobile app now. Reconcile is the part still to prove.',
      'The docs search bug turned out to be the query going through unquoted. One-line fix, test added.',
      'Cold start is at 1.8s on the test device, down from 2.4. Most of what is left is restoring the session.',
      'Anybody know why CI takes four minutes longer since Tuesday? Not blocking, but it is annoying.',
    ],
    thread: [
      'Which flag is it behind?',
      'kern.mobile.offline — off everywhere except the two test devices.',
      'Good. Let us leave it there until the reconcile has run for a week.',
    ],
  },
  {
    name: 'product',
    topic: 'What we are building and why',
    purpose: 'Roadmap, research and the arguments behind both.',
    type: 'public',
    messages: [
      'Onboarding research is written up in Product → Research. Six sessions, and the finding is blunt: four of six landed on an empty workspace and stopped.',
      'That is the argument for shipping example content on a new workspace. It is a small piece of work for the single biggest drop-off we have.',
      'Agreed. Putting it in this cycle.',
    ],
  },
  {
    name: 'support',
    topic: 'Customer questions and escalations',
    purpose: 'Everything that arrives from a customer, triaged daily.',
    type: 'public',
    messages: [
      'Export timing out for the customer on the business plan. Raised as SUP-1, and they have a manual export in the meantime.',
      'The DKIM problem is one domain only. Their provider is rejecting the signature; we are not doing anything wrong that I can find.',
      'Third person this month asking how to move a project between workspaces. There is still no answer because there is still no way to do it.',
    ],
  },
  {
    name: 'design',
    topic: 'Work in progress, feedback welcome',
    purpose: 'Screens, prototypes and the reasoning behind them.',
    type: 'public',
    messages: [
      'Pricing page, second pass. Three columns, comparison table underneath, annual toggle dropped for now.',
      'The empty states are the thing I keep coming back to. A screen that explains itself is a screen that has nothing on it.',
    ],
  },
  {
    name: 'incidents',
    topic: 'Only during an incident',
    purpose: 'Kept quiet on purpose. When something is broken, this is where it is coordinated.',
    type: 'private',
    messages: ['Nothing open. The runbook is in Engineering → Runbook: the site is down.'],
  },
]

export async function seedChatDemo(ctx: DemoSeedContext): Promise<DemoSeedSummary> {
  const { kernel, workspaceId, actor, actorId } = ctx
  const svc = chatServices(kernel)

  /*
   * The guard counts messages somebody **wrote**, and every word of that is load-bearing.
   *
   * Not channels: chat subscribes to `core.workspace.created` and makes `#general` and `#random`
   * before anybody has done anything, so an untouched workspace already has channels in it. And not
   * messages either — creating a channel posts a `system` message announcing it, so an untouched
   * workspace has four of those too, and a guard that counted them skipped every seed. Measured:
   * the first run of this test seeded nothing and reported success.
   *
   * The same fact decides how a channel is made below. Both events reach this service, on different
   * subjects, with no ordering between them — so the bootstrap may have run or may be about to, and
   * `#general` has to be *found or made* rather than assumed either way.
   */
  const { used, existing } = await kernel.database.withWorkspace(workspaceId, async (tx) => {
    const [message] = await tx
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(eq(messagesTable.workspaceId, workspaceId), eq(messagesTable.kind, 'user')))
      .limit(1)
    const rows = await tx
      .select({ id: channels.id, slug: channels.slug })
      .from(channels)
      .where(eq(channels.workspaceId, workspaceId))
    return { used: !!message, existing: new Map(rows.map((r) => [r.slug, r.id])) }
  })
  if (used) return { skipped: true }

  let messages = 0
  let made = 0
  for (const seed of CHANNELS) {
    const already = existing.get(seed.name)
    const channel = already
      ? { id: already }
      : await svc.channels
          .create(workspaceId, actor, {
            name: seed.name,
            type: seed.type,
            topic: seed.topic,
            purpose: seed.purpose,
            memberIds: actorId ? [actorId] : [],
            autoJoin: seed.type === 'public',
          })
          .then((c) => {
            made += 1
            return c
          })
    let first: string | null = null
    for (const text of seed.messages) {
      const posted = await svc.messages.post(workspaceId, actor, {
        channelId: channel.id,
        body: textToDoc(text),
      })
      first ??= posted.id
      messages += 1
    }
    for (const text of seed.thread ?? []) {
      if (!first) break
      await svc.messages.post(workspaceId, actor, {
        channelId: channel.id,
        body: textToDoc(text),
        threadRootId: first,
      })
      messages += 1
    }
  }

  return { created: { channels: made, messages } }
}
