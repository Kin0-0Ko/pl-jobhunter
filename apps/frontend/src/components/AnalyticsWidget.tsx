interface SkillCount {
  skill: string;
  count: number;
}

interface AnalyticsWidgetProps {
  topSkills: SkillCount[];
}

export function AnalyticsWidget({ topSkills }: AnalyticsWidgetProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 min-w-48">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Top 5 Skills</h3>
      {topSkills.length === 0 ? (
        <p className="text-xs text-gray-400">No high-match jobs yet</p>
      ) : (
        <ol className="space-y-1.5">
          {topSkills.map(({ skill, count }, i) => (
            <li key={skill} className="flex items-center gap-2 text-sm">
              <span className="text-gray-400 w-4 text-right text-xs">{i + 1}.</span>
              <span className="flex-1 text-gray-800 truncate">{skill}</span>
              <span className="bg-blue-100 text-blue-700 text-xs font-medium px-1.5 py-0.5 rounded">
                {count}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
