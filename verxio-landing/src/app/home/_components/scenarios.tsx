interface SimulationScenario {
  prompt: string;
  steps: { label: string; detail: string }[];
  completion: { name: string; summary: string };
}

export const SCENARIOS: SimulationScenario[] = [
  {
    prompt: '"Send the calendar invite I have open"',
    steps: [
      { label: "Looking", detail: "Calendar on your screen" },
      { label: "Moving", detail: "Cursor to the invite" },
      { label: "Typing", detail: "Guest and time filled in" },
      { label: "Clicking", detail: "Send" },
    ],
    completion: {
      name: "Invite sent",
      summary: "The agent used the app on your screen",
    },
  },
  {
    prompt: '"Summarize the notes in this project and draft a reply"',
    steps: [
      { label: "Opening", detail: "Documents/Verxio" },
      { label: "Reading", detail: "Three notes in the project" },
      { label: "Drafting", detail: "Reply in the workspace" },
    ],
    completion: {
      name: "Draft ready",
      summary: "Files and chat, in one workspace",
    },
  },
  {
    prompt: '"Transcribe the screen recording in Notepad"',
    steps: [
      { label: "Playing", detail: "Notepad recording" },
      { label: "Transcribing", detail: "Whisper on this machine" },
      { label: "Writing", detail: "Transcript saved to the note" },
    ],
    completion: {
      name: "Transcript ready",
      summary: "On-device Whisper",
    },
  },
  {
    prompt: '"File this chat under Tech Team"',
    steps: [
      { label: "Finding", detail: "Tech Team project" },
      { label: "Moving", detail: "Chat filed into the folder" },
    ],
    completion: {
      name: "Chat filed",
      summary: "Projects stay in the sidebar",
    },
  },
  {
    prompt: '"Check the unread threads in Gmail and Slack"',
    steps: [
      { label: "Opening", detail: "Gmail" },
      { label: "Opening", detail: "Slack" },
      { label: "Summarizing", detail: "Three threads need a reply" },
    ],
    completion: {
      name: "Inbox brief ready",
      summary: "Connected apps, one agent",
    },
  },
  {
    prompt: '"Reply on Telegram that the proposal is ready"',
    steps: [
      { label: "Opening", detail: "Telegram" },
      { label: "Writing", detail: "The proposal is ready" },
      { label: "Sending", detail: "Message delivered" },
    ],
    completion: {
      name: "Message sent",
      summary: "Same agent, your channels",
    },
  },
];
