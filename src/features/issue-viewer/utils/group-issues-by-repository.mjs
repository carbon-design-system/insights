export const primaryRepository = "carbon-design-system/carbon";

export function groupIssuesByRepository(issues) {
  const repositories = new Map();

  for (const issue of issues) {
    const repositoryName = issue.repository.full_name;
    const repositoryIssues = repositories.get(repositoryName) ?? [];

    repositoryIssues.push(issue);
    repositories.set(repositoryName, repositoryIssues);
  }

  return Array.from(repositories, ([name, repositoryIssues]) => ({
    name,
    issues: repositoryIssues,
  })).sort((first, second) => {
    if (first.name === primaryRepository) {
      return -1;
    }

    if (second.name === primaryRepository) {
      return 1;
    }

    return first.name.localeCompare(second.name);
  });
}
