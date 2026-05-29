import { getReviewStore } from '$lib/server/storage/store';

export function load() {
	const store = getReviewStore();
	return {
		reviews: store.listReviews().map((review) => ({
			...review,
			latestVersion: store.getLatestVersion(review.id)
		}))
	};
}
