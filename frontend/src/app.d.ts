// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { AuthSession, AuthUser } from '$lib/server/auth';
import type { Role } from 'bnr-shared/domain/state-machine';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: AuthUser | null;
			session: AuthSession | null;
			roles: Role[];
		}
		interface PageData {
			user: AuthUser | null;
			roles: Role[];
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
