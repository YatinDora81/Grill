import { test, expect } from "bun:test";
import { render, fireEvent } from "@testing-library/react";
import { useState } from "react";

function Controlled({ onType }: { onType: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div>
      <textarea
        aria-label="answer"
        value={value}
        onChange={(e) => {
          onType();
          setValue(e.target.value);
        }}
      />
      <p data-testid="echo">{value}</p>
    </div>
  );
}

test("React's onChange fires for a controlled field, and the tree re-renders", () => {
  let calls = 0;
  const { getByLabelText, getByTestId } = render(<Controlled onType={() => (calls += 1)} />);

  fireEvent.change(getByLabelText("answer"), { target: { value: "typed" } });

  expect(calls).toBe(1);
  expect(getByTestId("echo").textContent).toBe("typed");
});
