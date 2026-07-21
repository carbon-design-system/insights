export const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function getDayName(date) {
  // Match the local timezone used when issue timestamps are rendered in the table.
  return dayNames[new Date(date).getDay()];
}

export function filterIssuesByDay(issues, selectedDay) {
  return issues.filter(
    (issue) => getDayName(issue.created_at) === selectedDay
  );
}
