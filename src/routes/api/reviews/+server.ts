import { json } from '@sveltejs/kit';
import { getReviewStore } from '$lib/server/storage/store';

export function GET() {
	const store = getReviewStore();
	const reviews = store.listReviews().map((review) => ({
		...review,
		latestVersion: store.getLatestVersion(review.id)
	}));
	return json({ reviews });
}
