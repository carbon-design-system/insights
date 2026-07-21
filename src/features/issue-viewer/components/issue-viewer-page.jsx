"use client";

import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionItem,
  Column,
  Grid,
  Heading,
  InlineLoading,
  Loading,
  Section,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@carbon/react";
import { fetchTriageIssues } from "@/features/issue-viewer/api/fetch-triage-issues.mjs";
import {
  groupIssuesByRepository,
  primaryRepository,
} from "@/features/issue-viewer/utils/group-issues-by-repository.mjs";
import {
  dayNames,
  filterIssuesByDay,
  getDayName,
} from "@/features/issue-viewer/utils/filter-issues-by-day.mjs";

export function IssueViewerPage() {
  const [selectedDay, setSelectedDay] = useState(null);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const requestedDay = searchParams.get("day");
    const normalizedDay = requestedDay
      ? requestedDay.charAt(0).toUpperCase() +
        requestedDay.slice(1).toLowerCase()
      : null;

    setSelectedDay(
      dayNames.includes(normalizedDay) ? normalizedDay : getDayName(new Date())
    );
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadIssues() {
      try {
        const nextIssues = await fetchTriageIssues({
          signal: abortController.signal,
        });

        if (!abortController.signal.aborted) {
          setIssues(nextIssues);
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setError(fetchError.message);
          setIssues([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadIssues();

    return () => abortController.abort();
  }, []);

  const selectedIssues = selectedDay
    ? filterIssuesByDay(issues, selectedDay)
    : [];
  const issueNoun = selectedIssues.length === 1 ? "issue" : "issues";
  const repositoryGroups = groupIssuesByRepository(selectedIssues);

  function handleDayChange(event) {
    const nextDay = event.target.value;
    const nextUrl = new URL(window.location.href);

    nextUrl.searchParams.set("day", nextDay.toLowerCase());
    window.history.replaceState(
      {},
      "",
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
    );
    setSelectedDay(nextDay);
  }

  return (
    <>
      {(loading || !selectedDay) && <Loading active />}

      {!loading && selectedDay && (
        <Grid narrow fullWidth className="app-page">
          <Column sm={4} md={8} lg={16}>
            <Section className="issue-viewer__summary">
              <div className="issue-viewer__heading">
                <Heading
                  aria-label={`${selectedIssues.length} ${issueNoun} opened on a ${selectedDay}`}
                >
                  {selectedIssues.length} {issueNoun} opened on a
                </Heading>
                <Select
                  hideLabel
                  id="issue-viewer-day"
                  inline
                  labelText="Day of week"
                  onChange={handleDayChange}
                  size="md"
                  value={selectedDay}
                >
                  {dayNames.map((day) => (
                    <SelectItem key={day} text={day} value={day} />
                  ))}
                </Select>
              </div>
              {error && (
                <InlineLoading
                  status="error"
                  description={`Error: ${error}`}
                />
              )}
            </Section>
          </Column>

          <Column sm={4} md={8} lg={16}>
            <Accordion
              align="start"
              aria-label="Issues grouped by repository"
              className="issue-viewer__accordion"
              key={selectedDay}
            >
              {repositoryGroups.map(({ name, issues: repositoryIssues }) => (
                <AccordionItem
                  key={name}
                  open={name === primaryRepository}
                  title={`${name} (${repositoryIssues.length})`}
                >
                  <TableContainer>
                    <Table size="lg">
                      <TableHead>
                        <TableRow>
                          <TableHeader scope="col">Issue</TableHeader>
                          <TableHeader scope="col">Title</TableHeader>
                          <TableHeader scope="col">Created</TableHeader>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {repositoryIssues.map((issue) => (
                          <TableRow key={issue.id}>
                            <TableCell className="issue-viewer__issue-number">
                              #{issue.number}
                            </TableCell>
                            <TableCell>
                              <a
                                href={issue.html_url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {issue.title}
                              </a>
                            </TableCell>
                            <TableCell className="issue-viewer__timestamp">
                              {new Date(issue.created_at).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </AccordionItem>
              ))}
            </Accordion>
          </Column>
        </Grid>
      )}
    </>
  );
}
