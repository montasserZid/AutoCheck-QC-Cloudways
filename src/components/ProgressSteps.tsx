export function ProgressSteps({ current }: { current: number }) {
  return (
    <ol className="progress-steps" aria-label="Report progress">
      {["Add listing", "Review vehicle", "Choose report", "See result"].map(
        (label, index) => (
          <li
            key={label}
            className={
              index === current ? "active" : index < current ? "complete" : ""
            }
            aria-current={index === current ? "step" : undefined}
          >
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </li>
        ),
      )}
    </ol>
  );
}
