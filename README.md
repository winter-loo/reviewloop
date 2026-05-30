# LTSQL Review Platform

LTSQL Review Platform 是一个面向 LTSQL 本地开发流程的轻量级 code review 工具。它把 Git diff 捕获成持久、只读的 review 快照，并通过 CLI、Web 页面和 HTTP API 提供查看与评论能力，方便在提交前做本地评审。

## 项目目标

- **不修改源仓库**：平台只读取 Git diff，不会在被 review 的 LTSQL 工作区内写文件、commit 或 push。
- **持久化快照**：review 的 diff、文件统计和评论会保存到独立目录，默认是 `~/.ltsql-review`，也可以通过 `LTSQL_REVIEW_HOME` 指定。
- **CLI + Web 一体**：CLI 用于发布和查询 review，SvelteKit Web 页面/API 用于浏览 diff 和提交评论。
- **适合本地流程**：优先服务本地开发、提交前评审、临时 review 链接分享等场景。

## 功能概览

- 发布 worktree、staged、range、show 四类 Git diff review 快照。
- SQLite 保存 review 元数据和评论。
- artifact 文件保存每个 review version 的 `diff.patch` 和 `files.json`。
- Web 页面：
  - `/reviews`：review 列表。
  - `/reviews/<review-id>`：review 详情、文件统计、diff、评论。
- API：
  - `GET /api/reviews`
  - `GET /api/reviews/<review-id>`
  - `GET /api/reviews/<review-id>/versions/<version>/diff`
  - `GET /api/reviews/<review-id>/comments`
  - `POST /api/reviews/<review-id>/comments`

## 环境要求

- Node.js 24+ / npm
- Git
- 可写的 review 存储目录，默认：`~/.ltsql-review`

> 运行时使用 Node 24 内置 `node:sqlite`，不依赖 `better-sqlite3` 这类 native npm addon。因此可以在本地生成运行产物，再把 tar 包复制到 `ltsql` 上运行，目标机不需要执行 `npm install`。

安装依赖：

```bash
npm install
```

## 存储目录配置

默认情况下，平台会把 review 数据保存到：

```text
~/.ltsql-review
```

目录内包含：

```text
reviews.db                  # SQLite 元数据和评论
artifacts/<review-id>/v1/   # diff.patch、files.json 等快照文件
```

推荐在开发、测试或 smoke test 时显式指定：

```bash
export LTSQL_REVIEW_HOME=/tmp/ltsql-review-home
```

如果需要让 CLI 输出的 review URL 指向指定服务地址，可以设置：

```bash
export LTSQL_REVIEW_BASE_URL=http://localhost:5173
```

## 启动 Web 服务

开发模式启动：

```bash
npm run dev
```

指定监听地址和端口：

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

启动后访问：

```text
http://localhost:5173/reviews
```

## CLI 使用

CLI 入口：

```bash
npx ltsql-review --help
```

也可以直接执行本仓库里的入口文件：

```bash
node ./bin/ltsql-review.js --help
```

### 发布当前 worktree diff

用于 review 当前工作区未提交修改：

```bash
npx ltsql-review publish \
  --repo /path/to/ltsql-worktree \
  --type worktree \
  --title "TASK-12345 本地修改评审"
```

输出示例：

```text
Created review CR-20260529-6683
URL: http://localhost:5173/reviews/CR-20260529-6683
Files: 3
```

### 发布 staged diff

用于 review 已 `git add` 但还没 commit 的改动：

```bash
npx ltsql-review publish \
  --repo /path/to/ltsql-worktree \
  --type staged \
  --title "TASK-12345 staged diff 评审"
```

### 发布一个 commit range

用于 review 一段 commit 范围：

```bash
npx ltsql-review publish \
  --repo /path/to/ltsql-worktree \
  --range "origin/main..HEAD" \
  --title "TASK-12345 commit range 评审"
```

### 发布单个 ref/show

用于 review 某个 commit 或 ref：

```bash
npx ltsql-review publish \
  --repo /path/to/ltsql-worktree \
  --show HEAD \
  --title "TASK-12345 HEAD 评审"
```

### 查看 review 列表

```bash
npx ltsql-review list
```

输出格式：

```text
<review-id>    <status>    <title>    <repo-root>
```

### 查看评论

普通文本输出：

```bash
npx ltsql-review comments --review CR-20260529-6683
```

JSON 输出：

```bash
npx ltsql-review comments --review CR-20260529-6683 --json
```

## API 评论示例

创建一条文件行评论：

```bash
curl -sS -X POST "http://localhost:5173/api/reviews/CR-20260529-6683/comments" \
  -H 'content-type: application/json' \
  --data '{
    "author": "winterloo",
    "body": "这里需要确认兼容性影响。",
    "filePath": "src/example.sql",
    "lineStart": 42,
    "side": "new"
  }'
```

查询评论：

```bash
curl -sS "http://localhost:5173/api/reviews/CR-20260529-6683/comments"
```

## Build / Check / Test

类型和 Svelte 检查：

```bash
npm run check
```

运行测试：

```bash
npm test
```

生产构建：

```bash
npm run build
```

构建 CLI 运行产物：

```bash
npm run build:cli
```

生成可复制到 `ltsql` 的免安装部署包：

```bash
npm run package:ltsql
```

产物路径：

```text
dist/ltsql-review-platform.tar.gz
```

本地预览生产构建：

```bash
npm run preview
```

> 当前项目使用 `@sveltejs/adapter-node`，`npm run build` 会生成可由 `node build` 启动的服务端产物。

## 部署到 ltsql 个人目录

LTSQL worktree 在 `ltsql` 机器的 `/data/ludd50155/...` 下时，review 服务也需要运行在能访问这些路径的机器上。推荐把本地构建好的 tar 包复制到 `ltsql` 个人目录运行，不在 `ltsql` 上执行 `npm install`。

本地构建并上传：

```bash
cd /home/ldd/projects/ltsql-review-platform
npm run package:ltsql

scp dist/ltsql-review-platform.tar.gz \
  ltsql:/data/ludd50155/tools/ltsql-review-platform.tar.gz
```

在 `ltsql` 上解包并启动：

```bash
ssh ltsql
cd /data/ludd50155/tools
tar -xzf ltsql-review-platform.tar.gz
cd ltsql-review-platform

export PATH=/data/ludd50155/node-v24.13.0/bin:$PATH
export LTSQL_REVIEW_HOME=/data/ludd50155/.ltsql-review
export LTSQL_REVIEW_BASE_URL=http://localhost:5173
export HOST=127.0.0.1
export PORT=5173

./start-ltsql-review.sh
```

如果希望后台运行，可以用：

```bash
nohup ./start-ltsql-review.sh > ltsql-review.log 2>&1 &
```

本地浏览器访问建议走 SSH tunnel：

```bash
ssh -N -L 5174:127.0.0.1:5173 ltsql
```

然后打开：

```text
http://localhost:5174/reviews
```

在 `ltsql` 上发布真实 worktree review：

```bash
cd /data/ludd50155/tools/ltsql-review-platform
export PATH=/data/ludd50155/node-v24.13.0/bin:$PATH
export LTSQL_REVIEW_HOME=/data/ludd50155/.ltsql-review
export LTSQL_REVIEW_BASE_URL=http://localhost:5173

node dist-cli/ltsql-review.js publish \
  --repo /data/ludd50155/ltsql_branches/integration-test-oracle \
  --type worktree \
  --title "LTSQL 本地修改评审"
```

## LTSQL 本地评审推荐流程

1. 在 LTSQL 工作区完成修改。
2. 按评审对象选择发布方式：
   - **未提交 worktree 改动**：用 `--type worktree`。
   - **已提交的一组本地 commit**：用 `--range`，例如 `refs/remotes/git-svn..HEAD`。
   - **单个合并/最终 commit**：用 `--show <commit>`。

发布未提交 worktree 改动：

   ```bash
   LTSQL_REVIEW_BASE_URL=http://localhost:5173 \
   npx ltsql-review publish \
     --repo /path/to/ltsql-worktree \
     --type worktree \
     --title "<任务号> <评审标题>"
   ```

发布从 SVN base 到当前 HEAD 的所有本地 commit：

   ```bash
   LTSQL_REVIEW_BASE_URL=http://localhost:5173 \
   npx ltsql-review publish \
     --repo /data/ludd50155/ltsql_branches/integration-test-oracle \
     --range "refs/remotes/git-svn..HEAD" \
     --title "<任务号> 本地提交区间评审"
   ```

发布某个最终/合并 commit：

   ```bash
   LTSQL_REVIEW_BASE_URL=http://localhost:5173 \
   npx ltsql-review publish \
     --repo /data/ludd50155/ltsql_branches/integration-test-oracle \
     --show HEAD \
     --title "<任务号> final commit 评审"
   ```

3. 打开输出的 URL，在浏览器查看 diff。
4. 通过 Web/API 记录 review comments。
5. 根据 comments 修改源仓库代码。
6. 重新 publish 一个新的 review 快照，或在确认后进入本地 commit 流程。

## 安全边界

- 平台不会写入被 review 的 Git 源仓库。
- diff snapshot 存放在 `LTSQL_REVIEW_HOME`/`~/.ltsql-review` 下。
- 不要把包含敏感信息的 diff 发布到共享环境；如果 diff 中含凭证、token、密码等，应先在源仓库中移除或脱敏。
- 本项目当前是本地 MVP，Web/API 没有做完整的生产鉴权和权限隔离。
