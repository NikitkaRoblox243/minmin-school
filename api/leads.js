// Vercel function: the consultation form posts here; the bot forwards the lead to the school chat.
import { createLeadHandler } from '../server/index.mjs';

export default createLeadHandler();
