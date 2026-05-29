import { createReviewStore } from './db';

let store: ReturnType<typeof createReviewStore> | null = null;

export function getReviewStore() {
	store ??= createReviewStore();
	return store;
}
