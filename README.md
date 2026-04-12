# Carbon Insights

Surfacing issues and metrics not available through GitHub's interface.

## Deployment

GitHub Pages deployments use the official `actions/configure-pages` Next.js integration to
inject the correct deployment `basePath` during the workflow build. That lets the same project
build correctly for both a `github.io/<repo>` Pages URL and the custom domain
`insights.carbondesignsystem.com`, as long as that custom domain is configured in the repository's
GitHub Pages settings.

For local builds, the checked-in config defaults to the domain root. If you need a repository-path
build for a `github.io/<repo>` URL, override the base path explicitly:

```bash
PAGES_BASE_PATH=/insights yarn build:static
```
