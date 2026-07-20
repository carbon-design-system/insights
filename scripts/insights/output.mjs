import { styleText } from "node:util";

const unicodeSymbols = {
  info: "●",
  success: "◆",
  warning: "▲",
  error: "■",
  complete: "◇",
  pointer: "›",
  option: "○",
  guide: "│",
  start: "┌",
  end: "└",
};

const asciiSymbols = {
  info: "i",
  success: "*",
  warning: "!",
  error: "x",
  complete: "o",
  pointer: ">",
  option: "o",
  guide: "|",
  start: "+",
  end: "+",
};

const colors = {
  info: "blue",
  success: "green",
  warning: "yellow",
  error: "red",
  complete: "green",
  pointer: "cyan",
  option: "gray",
  guide: "gray",
  start: "cyan",
  end: "cyan",
};

// Unicode and color are presentation enhancements. The same meaning remains in
// ASCII when output is redirected, the terminal is limited, or color is off.
function supportsUnicode(stream, env) {
  return Boolean(stream.isTTY && env.TERM !== "dumb" && !("FORCE_ASCII" in env));
}

function supportsColor(stream, env, noColor) {
  return Boolean(
    stream.isTTY &&
      env.TERM !== "dumb" &&
      !("NO_COLOR" in env) &&
      !noColor,
  );
}

export function createCliOutput({
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  noColor = false,
  unicode = supportsUnicode(stdout, env),
  color = supportsColor(stdout, env, noColor),
} = {}) {
  const symbols = unicode ? unicodeSymbols : asciiSymbols;

  function style(kind, value) {
    const text = String(value);
    return color
      ? styleText(colors[kind] || kind, text, { validateStream: false })
      : text;
  }

  function token(kind) {
    return style(kind, symbols[kind]);
  }

  function writeLine(stream, kind, message = "") {
    stream.write(`${token(kind)}${message ? `  ${message}` : ""}\n`);
  }

  function detailTo(stream, message = "") {
    writeLine(stream, "guide", message);
  }

  return {
    stdout,
    stderr,
    symbols,
    color,
    unicode,
    style,
    intro(message) {
      writeLine(stdout, "start", message);
    },
    info(message) {
      writeLine(stdout, "info", message);
    },
    success(message) {
      writeLine(stdout, "success", message);
    },
    step(message) {
      writeLine(stdout, "complete", message);
    },
    detail(message = "") {
      detailTo(stdout, message);
    },
    blank() {
      detailTo(stdout);
    },
    outro(message) {
      writeLine(stdout, "end", message);
    },
    text(message = "") {
      stdout.write(`${message}\n`);
    },
    warning(message, details = []) {
      writeLine(stderr, "warning", message);
      for (const detail of details) {
        detailTo(stderr, detail);
      }
    },
    failure(message, details = [], action) {
      writeLine(stderr, "error", message);
      for (const detail of details) {
        detailTo(stderr, detail);
      }
      if (action) {
        detailTo(stderr);
        writeLine(stderr, "end", action);
      }
    },
    promptOption(option, selected) {
      const state = selected ? "pointer" : "option";
      return `${token("guide")}  ${token(state)} ${option.label}`;
    },
    promptDescription(option) {
      return `${token("guide")}    ${option.description}`;
    },
    promptLines(question, options, selectedIndex) {
      return [
        `${token("success")}  ${question}`,
        ...options.flatMap((option, index) => {
          const title = this.promptOption(option, index === selectedIndex);
          return option.description
            ? [title, this.promptDescription(option)]
            : [title];
        }),
        token("guide"),
        `${token("end")}  Use arrow keys and Enter; Esc to cancel`,
      ];
    },
    hideCursor() {
      stdout.write("\u001B[?25l");
    },
    showCursor() {
      stdout.write("\u001B[?25h");
    },
    table(headers, rows, { rightAlign = [] } = {}) {
      stdout.write(`${renderTable(headers, rows, { unicode, style, rightAlign })}\n`);
    },
  };
}

export function renderTable(
  headers,
  rows,
  { unicode = true, style = (_kind, value) => String(value), rightAlign = [] } = {},
) {
  // Widths are calculated from raw text before styling so ANSI color sequences
  // do not disturb column alignment in an interactive terminal.
  const widths = headers.map((header, columnIndex) =>
    Math.max(
      String(header).length,
      ...rows.map((row) => String(row[columnIndex]).length),
    ),
  );
  const characters = unicode
    ? { vertical: "│", top: ["┌", "┬", "┐"], middle: ["├", "┼", "┤"], bottom: ["└", "┴", "┘"], horizontal: "─" }
    : { vertical: "|", top: ["+", "+", "+"], middle: ["+", "+", "+"], bottom: ["+", "+", "+"], horizontal: "-" };
  const border = ([left, middle, right]) =>
    `${left}${widths.map((width) => characters.horizontal.repeat(width + 2)).join(middle)}${right}`;
  const row = (cells, header = false) =>
    `${characters.vertical}${cells
      .map((cell, columnIndex) => {
        const value = String(cell);
        const padded = rightAlign.includes(columnIndex) && !header
          ? value.padStart(widths[columnIndex])
          : value.padEnd(widths[columnIndex]);
        const rendered = header ? style("complete", padded) : padded;
        return ` ${rendered} `;
      })
      .join(characters.vertical)}${characters.vertical}`;

  return [
    border(characters.top),
    row(headers, true),
    border(characters.middle),
    ...rows.map((cells) => row(cells)),
    border(characters.bottom),
  ].join("\n");
}
