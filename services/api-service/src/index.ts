import 'dotenv/config'
import express from 'express'
import { createJobRouter } from './routes/jobs'

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-service' })
})

app.use('/jobs', createJobRouter())

app.listen(PORT, () => {
  console.log(`api-service running on port ${PORT}`)
})
