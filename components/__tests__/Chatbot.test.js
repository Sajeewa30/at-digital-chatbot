import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Chatbot from "../Chatbot";

const baseConfig = {
  typingSpeedMs: 1,
  webhook: { route: "general" },
  branding: {
    logo: "",
    name: "AT Digital",
    welcomeText: "Hi there! Welcome to AT Digital.",
    responseTimeText: "We typically respond right away",
    poweredBy: {
      text: "Powered by AT Digital",
      link: "https://atdigital.io/",
    },
  },
  style: {
    primaryColor: "#4C46F7",
    secondaryColor: "#7A5CFF",
    position: "right",
    backgroundColor: "#0B1025",
    fontColor: "#E4E7FF",
  },
};

const renderChatbot = (overrides = {}) =>
  render(<Chatbot config={{ ...baseConfig, ...overrides }} />);

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ output: "Mocked reply" }),
    })
  );
  window.open = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("Chatbot", () => {
  it("opens the widget and shows the conversational hero", async () => {
    renderChatbot();
    const user = userEvent.setup();

    const toggle = await screen.findByLabelText(/open chat/i);
    await user.click(toggle);

    expect(await screen.findByText(/welcome to at digital/i)).toBeInTheDocument();
  });

  it("starts a conversation and types the welcome message", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderChatbot();
    await user.click(await screen.findByLabelText(/open chat/i));

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    expect(
      await screen.findByText("Hi there! Welcome to AT Digital.")
    ).toBeInTheDocument();

    jest.useRealTimers();
  });

  it("sends a typed message through the webhook proxy", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderChatbot();
    await user.click(await screen.findByLabelText(/open chat/i));
    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    const textarea = await screen.findByPlaceholderText(/ask at digital anything/i);
    await user.type(textarea, "Hello there??");

    const sendButton = screen.getByRole("button", { name: /^send$/i });
    await user.click(sendButton);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, options] = global.fetch.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.chatInput).toBe("Hello there");
    expect(payload.route).toBe("general");

    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(await screen.findByText("Mocked reply")).toBeInTheDocument();

    jest.useRealTimers();
  });

  it("sends a quick reply and hides the quick reply buttons afterwards", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderChatbot();
    await user.click(await screen.findByLabelText(/open chat/i));
    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    const quickReply = await screen.findByRole("button", {
      name: `What are the services of AT Digital`,
    });
    await user.click(quickReply);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.chatInput).toBe("What are the services of AT Digital");

    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: `What are the services of AT Digital`,
        })
      ).not.toBeInTheDocument();
    });
  });
});
