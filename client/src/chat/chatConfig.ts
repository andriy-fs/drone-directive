import type { ChatConfig } from '@drone-directive/chat';
import { MULTIPLAYER_URL } from '../config/multiplayer';

/**
 * Everything `@drone-directive/chat` needs to know about *this* application —
 * which, unlike the game's `lockstepConfig`, is only where the relay lives. The
 * chat package validates nothing about the match, so there is no thunk here and
 * nothing that changes between matches.
 *
 * The URL is the same relay the game uses: the `Chat` Durable Object lives behind
 * it on `/chat`, so there is one host to configure and one to deploy.
 */
export const chatConfig: ChatConfig = { relayUrl: MULTIPLAYER_URL };
