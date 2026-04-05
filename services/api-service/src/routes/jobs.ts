import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '@concierge/db'
import { ValidationError, NotFoundError } from '@concierge/errors'

const CreateJobSchema = z.object({
  type: z.enum(['ride', 'delivery', 'grocery']),
  provider: z.enum(['uber_sim', 'doordash_sim']),
  idempotencyKey: z.string().min(1),
  callerPhone: z.string().optional(),
  callSid: z.string().optional(),
  payload: z.record(z.unknown()),
})

export function createJobRouter(): Router {
  const router = Router()

  router.post('/', async (req: Request, res: Response) => {
    try {
      const parsed = CreateJobSchema.safeParse(req.body)

      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0].message)
      }

      const {
        type,
        provider,
        idempotencyKey,
        callerPhone,
        callSid,
        payload,
      } = parsed.data

      // Idempotency check — dead-end exit, no reprocessing
      const existing = await prisma.job.findUnique({
        where: { idempotencyKey },
      })

      if (existing) {
        return res.status(200).json({
          id: existing.id,
          status: existing.status,
          idempotencyKey: existing.idempotencyKey,
          createdAt: existing.createdAt,
          deduplicated: true,
        })
      }

      // Create new job
      const job = await prisma.job.create({
        data: {
          id: uuidv4(),
          idempotencyKey,
          type,
          provider,
          status: 'pending',
          callerPhone: callerPhone ?? null,
          callSid: callSid ?? null,
          requestPayload: payload,
          maxAttempts: parseInt(process.env.MAX_JOB_ATTEMPTS || '5'),
        },
      })

      // Publish to queue
      await publishToQueue({
        jobId: job.id,
        type: job.type,
        provider: job.provider,
      })

      return res.status(201).json({
        id: job.id,
        status: job.status,
        idempotencyKey: job.idempotencyKey,
        createdAt: job.createdAt,
        deduplicated: false,
      })

    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message, code: err.code })
      }
      console.error('POST /jobs error:', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const job = await prisma.job.findUnique({
        where: { id: req.params.id },
      })

      if (!job) {
        throw new NotFoundError('Job')
      }

      return res.status(200).json({
        id: job.id,
        type: job.type,
        status: job.status,
        provider: job.provider,
        idempotencyKey: job.idempotencyKey,
        callerPhone: job.callerPhone,
        providerJobId: job.providerJobId,
        attemptsCount: job.attemptsCount,
        lastError: job.lastError,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })

    } catch (err: unknown) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message, code: err.code })
      }
      console.error('GET /jobs/:id error:', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

async function publishToQueue(message: {
  jobId: string
  type: string
  provider: string
}): Promise<void> {
  // Placeholder — BullMQ queue client wired in next step
  console.log('[queue] publishing message:', JSON.stringify(message))
}
