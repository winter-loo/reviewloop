import { createReviewStore } from '../lib/server/storage/db';
import { getGitRoot } from '../lib/server/git/git';
import { publishReview } from '../lib/server/reviews/publish';
import type { ReviewSourceKind } from '../lib/server/storage/types';

function parseArgs(argv: string[]) {
	const [command, ...rest] = argv;
	const flags = new Map<string, string | boolean>();
	const positionals: string[] = [];

	for (let i = 0; i < rest.length; i += 1) {
		const arg = rest[i];
		if (arg.startsWith('--')) {
			const key = arg.slice(2);
			const next = rest[i + 1];
			if (next && !next.startsWith('--')) {
				flags.set(key, next);
				i += 1;
			} else {
				flags.set(key, true);
			}
		} else {
			positionals.push(arg);
		}
	}

	return { command, flags, positionals };
}

function stringFlag(flags: Map<string, string | boolean>, name: string) {
	const value = flags.get(name);
	return typeof value === 'string' ? value : undefined;
}

function usage() {
	return `ltsql-review

Commands:
  publish --repo <git-root> [--type worktree|staged] [--range <range>] [--show <ref>] --title <title>
  list
  comments --review <id> --json
`;
}

function reviewSourceKind(value: string): ReviewSourceKind {
	if (value === 'worktree' || value === 'staged') return value;
	throw new Error(`Unsupported --type '${value}'. Use worktree or staged, or pass --range/--show.`);
}

async function main() {
	const { command, flags } = parseArgs(process.argv.slice(2));
	const store = createReviewStore();

	try {
		if (!command || command === 'help' || command === '--help') {
			console.log(usage());
			return;
		}

		if (command === 'publish') {
			const repoInput = stringFlag(flags, 'repo') ?? process.cwd();
			const repoRoot = await getGitRoot(repoInput);
			const title = stringFlag(flags, 'title') ?? 'Untitled LTSQL review';
			const range = stringFlag(flags, 'range');
			const show = stringFlag(flags, 'show');
			const type = reviewSourceKind(stringFlag(flags, 'type') ?? 'worktree');

			const sourceKind: ReviewSourceKind = range ? 'range' : show ? 'show' : type;
			const sourceRef = range ?? show ?? null;
			const result = await publishReview({
				repoRoot,
				title,
				sourceKind,
				sourceRef,
				createdBy: process.env.USER || 'unknown',
				store,
				baseUrl: process.env.LTSQL_REVIEW_BASE_URL || 'http://localhost:5173'
			});
			console.log(`Created review ${result.review.id}`);
			console.log(`URL: ${result.url}`);
			console.log(`Files: ${result.files.length}`);
			if (result.files.length === 0 && sourceKind === 'worktree') {
				console.log(
					'Hint: worktree review only captures uncommitted changes. For committed LTSQL work, publish a commit range, e.g. --range "refs/remotes/git-svn..HEAD".'
				);
			}
			return;
		}

		if (command === 'list') {
			const reviews = store.listReviews();
			if (reviews.length === 0) {
				console.log('No reviews.');
				return;
			}
			for (const review of reviews) {
				console.log(`${review.id}\t${review.status}\t${review.title}\t${review.repoRoot}`);
			}
			return;
		}

		if (command === 'comments') {
			const reviewId = stringFlag(flags, 'review');
			if (!reviewId) throw new Error('--review is required');
			const comments = store.listComments(reviewId);
			if (flags.has('json')) {
				console.log(JSON.stringify(comments, null, 2));
			} else {
				for (const comment of comments) {
					console.log(`${comment.id}\t${comment.status}\t${comment.filePath ?? '<general>'}:${comment.lineStart ?? ''}\t${comment.body}`);
				}
			}
			return;
		}

		throw new Error(`Unknown command: ${command}`);
	} finally {
		store.close();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
