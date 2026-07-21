import assert from "node:assert/strict";
import test from "node:test";

import {
  dayNames,
  filterIssuesByDay,
  getDayName,
} from "./filter-issues-by-day.mjs";

test("exposes the days in calendar order", () => {
  assert.deepEqual(dayNames, [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ]);
});

test("uses the local weekday shown by issue timestamps", () => {
  const monday = new Date(2026, 6, 20, 12).toISOString();
  const tuesday = new Date(2026, 6, 21, 12).toISOString();
  const issues = [
    { id: 1, created_at: monday },
    { id: 2, created_at: tuesday },
  ];

  assert.equal(getDayName(monday), "Monday");
  assert.deepEqual(filterIssuesByDay(issues, "Monday"), [issues[0]]);
  assert.deepEqual(filterIssuesByDay(issues, "Wednesday"), []);
});
