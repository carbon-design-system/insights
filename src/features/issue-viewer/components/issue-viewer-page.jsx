"use client";

import { useEffect, useState } from "react";
import {
  Heading,
  Section,
  Loading,
  InlineLoading,
  Grid,
  Column,
  Tabs,
  Tab,
  TabList,
  TabPanels,
  TabPanel,
  ContainedList,
  ContainedListItem,
} from "@carbon/react";

const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const owner = "carbon-design-system";
const repo = "carbon";
const label = "status: needs triage :female_detective:";

export function IssueViewerPage() {
  const today = new Date().getDay();
  const [selectedDay, setSelectedDay] = useState(dayNames[today]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const preselectedDay = searchParams.get("day");

    if (preselectedDay) {
      const formattedDay =
        preselectedDay.charAt(0).toUpperCase() +
        preselectedDay.slice(1).toLowerCase();

      if (dayNames.includes(formattedDay)) {
        setSelectedDay(formattedDay);
      }
    }
  }, []);

  useEffect(() => {
    async function fetchIssues() {
      setLoading(true);
      setError(null);

      try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`;
        const response = await fetch(apiUrl);

        if (!response.ok) {
          throw new Error(`GitHub API responded with ${response.status}`);
        }

        const data = await response.json();
        setIssues(data);
      } catch (fetchError) {
        setError(fetchError.message);
        setIssues([]);
      } finally {
        setLoading(false);
      }
    }

    fetchIssues();
  }, []);

  const issuesByDay = dayNames.reduce((accumulator, day) => {
    accumulator[day] = issues.filter((issue) => {
      const createdDate = new Date(issue.created_at);
      const issueDayName = dayNames[createdDate.getUTCDay()];

      return issueDayName === day;
    });

    return accumulator;
  }, {});

  return (
    <>
      {loading && <Loading active />}

      {!loading && (
        <Grid narrow fullWidth className="app-page">
          <Column sm={4} md={8} lg={16}>
            <Section className="issue-viewer__summary">
              <Heading>{issues.length} monorepo issues need triaged</Heading>
              {error && (
                <InlineLoading
                  status="error"
                  description={`Error: ${error}`}
                />
              )}
            </Section>
          </Column>

          <Column sm={4} md={8} lg={16}>
            <Tabs
              defaultSelectedIndex={dayNames.indexOf(selectedDay)}
              key={`issue-tabs-${selectedDay}`}
            >
              <TabList contained fullWidth aria-label="Issues grouped by day">
                {dayNames.map((day) => (
                  <Tab key={day} disabled={!issuesByDay[day]?.length}>
                    {day} ({issuesByDay[day]?.length || 0})
                  </Tab>
                ))}
              </TabList>
              <TabPanels>
                {dayNames.map((day) => (
                  <TabPanel key={`issue-tab-panel-${day}`}>
                    {issuesByDay[day]?.length ? (
                      <ContainedList
                        label={`${issuesByDay[day].length} issues opened on a ${day}`}
                      >
                        {issuesByDay[day].map((issue) => (
                          <ContainedListItem key={issue.id}>
                            <Grid condensed>
                              <Column sm={1} md={1} lg={1}>
                                #{issue.number}
                              </Column>
                              <Column sm={2} md={5} lg={11}>
                                <a
                                  href={issue.html_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {issue.title}
                                </a>
                              </Column>
                              <Column
                                sm={1}
                                md={2}
                                lg={4}
                                className="issue-viewer__timestamp"
                              >
                                Created on:{" "}
                                {new Date(issue.created_at).toLocaleString()}
                              </Column>
                            </Grid>
                          </ContainedListItem>
                        ))}
                      </ContainedList>
                    ) : (
                      <p>
                        There are no triageable issues that were created on a{" "}
                        {day}.
                      </p>
                    )}
                  </TabPanel>
                ))}
              </TabPanels>
            </Tabs>
          </Column>
        </Grid>
      )}
    </>
  );
}
