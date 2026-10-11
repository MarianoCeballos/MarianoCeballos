import { mkdir, writeFile } from "node:fs/promises";

const LOGIN = "MarianoCeballos";
const TOKEN = process.env.GH_TOKEN;
const OUT_DIR = "assets";
const SHOWN_LANGUAGES = new Set(["TypeScript", "JavaScript", "HTML", "CSS", "SCSS"]);
const LANGUAGE_LIMIT = 6;

const COLORS = {
  background: "#0b1f44",
  border: "#1e3a78",
  title: "#ffffff",
  text: "#c9d6f2",
  muted: "#7f93c0",
  accent: "#4ea1ff",
  track: "#162c5c",
};
const FONT = "Segoe UI, Helvetica, Arial, sans-serif";

async function graphql(query) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats",
    },
    body: JSON.stringify({ query }),
  });
  const payload = await response.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors));
  return payload.data;
}

async function fetchYearlyActivity() {
  const { user } = await graphql(`{ user(login: "${LOGIN}") { createdAt } }`);
  const firstYear = new Date(user.createdAt).getUTCFullYear();
  const lastYear = new Date().getUTCFullYear();
  const years = [];
  for (let year = firstYear; year <= lastYear; year += 1) years.push(year);

  const fields = years
    .map(
      (year) => `y${year}: contributionsCollection(from: "${year}-01-01T00:00:00Z", to: "${year}-12-31T23:59:59Z") {
        contributionCalendar { totalContributions }
        totalPullRequestContributions
        totalPullRequestReviewContributions
      }`,
    )
    .join("\n");
  const data = await graphql(`{ user(login: "${LOGIN}") { ${fields} } }`);

  return years.map((year) => {
    const entry = data.user[`y${year}`];
    return {
      year,
      contributions: entry.contributionCalendar.totalContributions,
      pullRequests: entry.totalPullRequestContributions,
      reviews: entry.totalPullRequestReviewContributions,
    };
  });
}

async function fetchLanguageSizes() {
  const sizes = new Map();
  let after = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const cursor = after ? `"${after}"` : "null";
    const data = await graphql(`{
      user(login: "${LOGIN}") {
        repositories(first: 100, after: ${cursor}, isFork: false, ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
          pageInfo { hasNextPage endCursor }
          nodes { languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } } }
        }
      }
    }`);
    const { nodes, pageInfo } = data.user.repositories;
    for (const repository of nodes) {
      for (const edge of repository.languages.edges) {
        const name = edge.node.name;
        if (!SHOWN_LANGUAGES.has(name)) continue;
        sizes.set(name, (sizes.get(name) ?? 0) + edge.size);
      }
    }
    hasNextPage = pageInfo.hasNextPage;
    after = pageInfo.endCursor;
  }
  return [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, LANGUAGE_LIMIT);
}

function frame(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  <text x="24" y="36" font-family="${FONT}" font-size="16" font-weight="600" fill="${COLORS.title}">${title}</text>
  ${body}
</svg>
`;
}

function renderActivity(yearly) {
  const width = 480;
  const height = 260;
  const left = 24;
  const right = 24;
  const baseline = 210;
  const plotHeight = 120;
  const maxValue = Math.max(...yearly.map((item) => item.contributions), 1);
  const slot = (width - left - right) / yearly.length;
  const barWidth = Math.min(48, slot * 0.6);

  const bars = yearly
    .map((item, index) => {
      const barHeight = Math.max(2, Math.round((item.contributions / maxValue) * plotHeight));
      const x = left + index * slot + (slot - barWidth) / 2;
      const y = baseline - barHeight;
      const center = x + barWidth / 2;
      return `<rect x="${x.toFixed(1)}" y="${y}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="4" fill="${COLORS.accent}"/>
  <text x="${center.toFixed(1)}" y="${y - 8}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${COLORS.text}">${item.contributions}</text>
  <text x="${center.toFixed(1)}" y="${baseline + 22}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${COLORS.muted}">${item.year}</text>`;
    })
    .join("\n  ");

  return frame(width, height, "Contributions per year", bars);
}

function renderLanguages(languages) {
  const width = 480;
  const height = 260;
  const total = languages.reduce((sum, [, size]) => sum + size, 0) || 1;
  const trackWidth = 432;
  const rowHeight = 32;

  const rows = languages
    .map(([name, size], index) => {
      const percent = (size / total) * 100;
      const y = 62 + index * rowHeight;
      const fill = Math.max(4, Math.round((percent / 100) * trackWidth));
      return `<text x="24" y="${y}" font-family="${FONT}" font-size="13" fill="${COLORS.text}">${name}</text>
  <text x="456" y="${y}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${COLORS.muted}">${percent.toFixed(1)}%</text>
  <rect x="24" y="${y + 7}" width="${trackWidth}" height="6" rx="3" fill="${COLORS.track}"/>
  <rect x="24" y="${y + 7}" width="${fill}" height="6" rx="3" fill="${COLORS.accent}"/>`;
    })
    .join("\n  ");

  return frame(width, height, "Languages", rows);
}

function renderSummary(yearly, languages) {
  const total = yearly.reduce((sum, item) => sum + item.contributions, 0);
  const activeYears = yearly.filter((item) => item.contributions > 0).length;
  const averagePerYear = Math.round(total / Math.max(activeYears, 1));
  const tiles = [
    ["Contributions", total.toLocaleString("en-US")],
    ["Years active", String(activeYears)],
    ["Average per year", averagePerYear.toLocaleString("en-US")],
    ["Main language", languages[0] ? languages[0][0] : "-"],
  ];

  const width = 980;
  const height = 120;
  const tileWidth = (width - 48) / tiles.length;
  const body = tiles
    .map(([label, value], index) => {
      const x = 24 + index * tileWidth;
      return `<text x="${x}" y="72" font-family="${FONT}" font-size="34" font-weight="700" fill="${COLORS.accent}">${value}</text>
  <text x="${x}" y="98" font-family="${FONT}" font-size="13" fill="${COLORS.muted}">${label}</text>`;
    })
    .join("\n  ");

  return frame(width, height, "Overview", body);
}

async function main() {
  if (!TOKEN) throw new Error("GH_TOKEN is required");
  const [yearly, languages] = await Promise.all([fetchYearlyActivity(), fetchLanguageSizes()]);
  await mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeFile(`${OUT_DIR}/summary.svg`, renderSummary(yearly, languages)),
    writeFile(`${OUT_DIR}/activity.svg`, renderActivity(yearly)),
    writeFile(`${OUT_DIR}/languages.svg`, renderLanguages(languages)),
  ]);
  console.log(JSON.stringify({ yearly, languages: languages.map(([name]) => name) }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
