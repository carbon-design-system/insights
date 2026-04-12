# Carbon Insights

Surfacing issues and metrics not available through GitHub's interface.

## Deployment

GitHub Pages deploys default to the custom domain `insights.carbondesignsystem.com`, which means the app is built for the domain root instead of a repository subpath.

If you need a repository-path build for a `github.io/<repo>` URL, override the base path
explicitly when building:

```bash
PAGES_BASE_PATH=/insights yarn build:static
```
