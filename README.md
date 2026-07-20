# Carbon Insights

Surfacing issues and metrics not available through GitHub's interface.

- The webapp is published to http://insights.carbondesignsystem.com/
- The CLI can be ran locally

## CLI usage

Install and confirm GitHub authentication:

```bash
yarn install
gh auth status
```

Run the CLI:

```bash
yarn insights
```

The Insights CLI does not store credentials. Every GitHub query runs through
`gh`, which uses the active local account.

### Commands

| Command                      | Behavior                                       |
| ---------------------------- | ---------------------------------------------- |
| `yarn insights`              | Open the interactive command selector          |
| `yarn insights --help`       | Show root command usage                        |
| `yarn insights pr`           | Count open pull requests; alias for `pr count` |
| `yarn insights pr count`     | Count open pull requests                       |
| `yarn insights pr reviews`   | Report five weeks of PR review activity        |
| `yarn insights pr open-rate` | Compare PR opening volume with the prior year  |
| `yarn insights pr stale`     | Find inactive PRs awaiting your review         |
| `yarn insights issue`        | Count open issues; alias for `issue count`     |
| `yarn insights issue count`  | Count open issues, excluding pull requests     |

### Configuration

Checked-in defaults live in `config/insights.json`:

```json
{
  "github": {
    "organization": "carbon-design-system",
    "repository": "carbon-design-system/carbon"
  },
  "reviews": {
    "users": [
      "kennylam",
      "tay1orjones",
      "emyarod",
      "riddhybansal",
      "devadula-nandan",
      "sangeethababu9223",
      "heloiselui",
      "maradwan26"
    ]
  },
  "stale": {
    "days": 14,
    "ignoredAuthors": ["dependabot", "renovate"]
  }
}
```
