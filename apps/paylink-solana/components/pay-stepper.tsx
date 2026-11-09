export function PayStepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="stepper" aria-label="Payment progress">
      {["Review", "Pay", "Done"].map((label, index) => {
        const number = index + 1;
        const complete = number < step;
        return (
          <li key={label} className={complete ? "done" : number === step ? "on" : ""} aria-current={number === step ? "step" : undefined}>
            <span className="stepper-dot" aria-hidden>{complete ? "✓" : number}</span>
            <span className="stepper-label">{label}<span className="sr-only">{complete ? " — completed" : number === step ? " — current" : " — upcoming"}</span></span>
          </li>
        );
      })}
    </ol>
  );
}
