import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import clsx from 'clsx';

import { useAllowedRanges, useOverview } from '../../hooks/useOverview.js';
import { useDeveloperModel } from '../../hooks/useDeveloperModel.js';
import { setQueryParams, useQueryParam, navigate } from '../../lib/router.js';
import { isDemoActive } from '../../lib/demoMode.js';
import { projectGradient } from '../../lib/projectGradient.js';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import RangePills from '../../components/RangePills/RangePills.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import Banner from '../../components/Banner/Banner.jsx';
import Tooltip from '../../components/Tooltip/Tooltip.jsx';
import VisualBadge from '../../components/VisualBadge/VisualBadge.jsx';
import OverviewStaleBanner from '../../components/Banner/OverviewStaleBanner.jsx';
import ProjectDropdown, {
  ProjectDropdownItem,
  ProjectDropdownItemName,
  ProjectDropdownRadioCheck,
  ProjectDropdownSwatch,
  ProjectDropdownTriggerLabel,
} from '../../components/ProjectDropdown/ProjectDropdown.js';
import { SkeletonRows, SkeletonLine } from '../../components/Skeleton/Skeleton.jsx';
import { forceRefresh } from '../../lib/stores/polling.js';
import glass from '../../components/surface/glass.module.css';
import ModelNarrativeRead from '../ModelView/ModelNarrativeRead.js';

import {
  COMPARE_METRICS,
  compareRepoOptions,
  resolveRepo,
  type CompareCell,
  type CompareRepoOption,
  type ResolvedRepo,
} from './compareMetrics.js';
import {
  buildCompareRenderItems,
  countHiddenCompareMetrics,
} from './compareMetricSections.js';
import {
  compilePeriodComparison,
  type PeriodComparison,
} from './compilePeriodComparison.js';
import { compileCompareNarrative } from './compileCompareNarrative.js';
import styles from './CompareView.module.css';

type RangeDays = 7 | 30 | 90;
type CompareMode = 'period' | 'repos';

/**
 * Compare answers the primary long-loop question first: how one stable scope
 * changed against its immediately prior equal window. Explicit repo A/B remains
 * available as a secondary drill, but no entry point invents the pair.
 */
export default function CompareView() {
  const ranges = useAllowedRanges();
  const rangeDays = parseRange(useQueryParam('range'), ranges);
  const mode: CompareMode = useQueryParam('mode') === 'repos' ? 'repos' : 'period';
  const scopeId = useQueryParam('scope') ?? '';
  const paramA = useQueryParam('a') ?? '';
  const paramB = useQueryParam('b') ?? '';
  const [showDetail, setShowDetail] = useState(false);
  const { overview, isLoading, error, isStale } = useOverview(rangeDays);

  const options = useMemo(() => compareRepoOptions(overview), [overview]);
  const scopedProject = useMemo(
    () => overview.usage.projects.find((project) => project.repoId === scopeId) ?? null,
    [overview, scopeId],
  );
  const period = useMemo(
    () => compilePeriodComparison(overview, scopedProject),
    [overview, scopedProject],
  );
  const repoA = useMemo(() => resolveRepo(overview, paramA), [overview, paramA]);
  const repoB = useMemo(() => resolveRepo(overview, paramB), [overview, paramB]);
  const renderItems = useMemo(
    () => buildCompareRenderItems(COMPARE_METRICS, showDetail),
    [showDetail],
  );

  const setMode = (next: CompareMode) => {
    setQueryParams({
      mode: next === 'repos' ? 'repos' : null,
      scope: next === 'period' ? scopeId || null : null,
      a: next === 'repos' ? paramA || null : null,
      b: next === 'repos' ? paramB || null : null,
    });
  };
  const setRange = (value: RangeDays) => {
    setQueryParams({ range: String(value) });
  };

  if (error && !overview.usage.projects.length && period.evidence.length === 0) {
    return (
      <div className={styles.page}>
        <StatusState
          tone="danger"
          eyebrow="Compare unavailable"
          title="Could not load comparison history"
          hint="The overview is temporarily unavailable."
          detail={error}
          meta="Compare"
          actionLabel="Retry"
          onAction={forceRefresh}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ViewHeader
        eyebrow={mode === 'period' ? 'Change over time' : 'Shared window'}
        title="Compare"
        demo={isDemoActive()}
      />
      <OverviewStaleBanner visible={isStale} />

      <div className={styles.controls}>
        <div
          className={clsx(styles.modeSwitch, glass.sheet, glass.rim)}
          role="group"
          aria-label="Comparison type"
        >
          <button
            type="button"
            className={clsx(styles.modeButton, mode === 'period' && styles.modeButtonActive)}
            aria-pressed={mode === 'period'}
            onClick={() => setMode('period')}
          >
            Periods
          </button>
          <button
            type="button"
            className={clsx(styles.modeButton, mode === 'repos' && styles.modeButtonActive)}
            aria-pressed={mode === 'repos'}
            onClick={() => setMode('repos')}
          >
            Repos
          </button>
        </div>
        {mode === 'period' && (
          <ScopePicker
            value={scopeId}
            options={options}
            missing={scopeId.length > 0 && scopedProject == null}
            onChange={(value) => setQueryParams({ scope: value || null })}
          />
        )}
        <RangePills
          value={rangeDays}
          onChange={(value) => setRange(value as RangeDays)}
          options={ranges}
        />
      </div>

      {isLoading && !overview.usage.projects.length ? (
        <div className={styles.loading}>
          <SkeletonLine width="100%" height={40} />
          <div style={{ marginTop: 20 }}>
            <SkeletonRows count={4} columns={3} />
          </div>
        </div>
      ) : mode === 'period' ? (
        <PeriodMode
          period={period}
          scopeMissing={scopeId.length > 0 && scopedProject == null}
          onCompareAllWork={() => setQueryParams({ scope: null })}
        />
      ) : (
        <RepoMode
          options={options}
          repoA={repoA}
          repoB={repoB}
          renderItems={renderItems}
          showDetail={showDetail}
          onShowDetail={setShowDetail}
          onRepoChange={(side, value) => setQueryParams({ [side]: value || null })}
          onSwap={() => setQueryParams({ a: paramB || null, b: paramA || null })}
        />
      )}
    </div>
  );
}

function PeriodMode({
  period,
  scopeMissing,
  onCompareAllWork,
}: {
  period: PeriodComparison;
  scopeMissing: boolean;
  onCompareAllWork: () => void;
}) {
  return (
    <section className={styles.periodMode} aria-label="Period comparison">
      {scopeMissing ? (
        <StatusState
          tone="neutral"
          eyebrow="Project unavailable"
          title="This project is not present in the selected window"
          hint="Choose another project or compare all work. Seorak will not substitute a different repo."
          meta="Compare"
          actionLabel="Compare all work"
          onAction={onCompareAllWork}
        />
      ) : (
        <AnnotatedPeriodRead period={period} />
      )}
    </section>
  );
}

function AnnotatedPeriodRead({ period }: { period: PeriodComparison }) {
  const { snapshot, isStale } = useDeveloperModel(period.rangeDays as RangeDays, {
    displayName: 'You',
    repoId: period.scope.repoId,
  });
  const offsetMinutes = useMemo(() => new Date().getTimezoneOffset(), []);
  const model =
    !isStale &&
    snapshot.scope.rangeDays === period.rangeDays &&
    snapshot.scope.repoId === period.scope.repoId
      ? snapshot
      : null;
  const presentation = useMemo(
    () => compileCompareNarrative(period, model, { offsetMinutes }),
    [period, model, offsetMinutes],
  );

  return (
    <ModelNarrativeRead
      presentation={presentation}
      ariaLabel="How this period changed"
    />
  );
}

function RepoMode({
  options,
  repoA,
  repoB,
  renderItems,
  showDetail,
  onShowDetail,
  onRepoChange,
  onSwap,
}: {
  options: CompareRepoOption[];
  repoA: ResolvedRepo;
  repoB: ResolvedRepo;
  renderItems: ReturnType<typeof buildCompareRenderItems>;
  showDetail: boolean;
  onShowDetail: (show: boolean) => void;
  onRepoChange: (side: 'a' | 'b', value: string) => void;
  onSwap: () => void;
}) {
  const bothPicked = repoA.status === 'ok' && repoB.status === 'ok';
  const sameRepo = bothPicked && repoA.data!.repoId === repoB.data!.repoId;
  const canRead = bothPicked && !sameRepo;
  const hiddenCount = countHiddenCompareMetrics(showDetail);

  if (options.length < 2) {
    return (
      <StatusState
        tone="neutral"
        eyebrow="Repo comparison"
        title="Two repos are needed for this drill"
        hint="Period comparison still works with all work or one project. Repo A/B fills in after a second repo has tracked activity."
        meta="Compare"
        actionLabel="Back to overview"
        onAction={() => navigate('overview')}
      />
    );
  }

  return (
    <section className={styles.repoMode} aria-label="Repo comparison">
      <div className={styles.table} role="table" aria-label="Repo compare">
        <div className={styles.headRow} role="row">
          <span className={styles.metricHead} role="columnheader">
            Stat
          </span>
          <RepoPicker
            side="a"
            repo={repoA}
            options={options}
            onChange={(value) => onRepoChange('a', value)}
          />
          <span className={styles.swapSlot} role="columnheader" aria-label="Swap repos">
            {bothPicked && (
              <Tooltip label="Swap repos" placement="bottom">
                <button
                  type="button"
                  className={clsx(styles.swapButton, glass.sheet, glass.rim)}
                  onClick={onSwap}
                  aria-label="Swap repos"
                >
                  <svg
                    className={styles.swapIcon}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 5.5h9" />
                    <path d="M9.5 3 12 5.5 9.5 8" />
                    <path d="M13 10.5H4" />
                    <path d="M6.5 8 4 10.5 6.5 13" />
                  </svg>
                </button>
              </Tooltip>
            )}
          </span>
          <RepoPicker
            side="b"
            repo={repoB}
            options={options}
            onChange={(value) => onRepoChange('b', value)}
          />
        </div>

        {!canRead ? (
          <div className={styles.repoState}>
            <Banner
              variant={sameRepo ? 'error' : 'info'}
              eyebrow={sameRepo ? 'Same repo' : 'Choose two repos'}
              actions={
                sameRepo
                  ? [{ label: 'Clear second repo', onClick: () => onRepoChange('b', '') }]
                  : undefined
              }
            >
              {sameRepo
                ? `Both sides are ${repoA.data!.project}. Choose a different repo for one side.`
                : 'Choose one repo for each side to compare them over the same window.'}
            </Banner>
          </div>
        ) : (
          <>
            {renderItems.map((item) => {
              if (item.kind === 'section') {
                return (
                  <div className={styles.sectionRow} role="row" key={`section-${item.id}`}>
                    <span className={styles.sectionLabel} role="rowheader">
                      {item.label}
                    </span>
                  </div>
                );
              }
              const { metric } = item;
              return (
                <div
                  className={styles.row}
                  role="row"
                  key={metric.id}
                  style={{ '--row-index': item.index } as CSSProperties}
                >
                  <span className={styles.metricLabel} role="rowheader" title={metric.hint}>
                    {metric.label}
                  </span>
                  <Cell cell={metric.read(repoA.data!)} />
                  <span className={styles.swapSlot} role="cell" />
                  <Cell cell={metric.read(repoB.data!)} />
                </div>
              );
            })}
            <div className={styles.detailFooter}>
              <button
                type="button"
                className={clsx(styles.detailToggle, glass.sheet, glass.rim)}
                onClick={() => onShowDetail(hiddenCount > 0)}
                aria-expanded={showDetail}
              >
                {hiddenCount > 0
                  ? `Show ${hiddenCount} more rows`
                  : 'Show fewer rows'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Cell({ cell }: { cell: CompareCell }) {
  return (
    <div className={styles.cell} role="cell" title={cell.hint}>
      <div className={styles.cellFace}>
        {cell.visual && !cell.empty && (
          <VisualBadge kind={cell.visual.kind} id={cell.visual.id} size={18} />
        )}
        <span className={cell.empty ? styles.cellValueEmpty : styles.cellValue}>{cell.value}</span>
      </div>
      {cell.sub && <span className={styles.cellSub}>{cell.sub}</span>}
    </div>
  );
}

function ScopePicker({
  value,
  options,
  missing,
  onChange,
}: {
  value: string;
  options: CompareRepoOption[];
  missing: boolean;
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <SimpleProjectPicker
      ariaLabel={`Comparison scope: ${selected?.label ?? (missing ? 'Unavailable project' : 'All work')}`}
      selectedValue={value}
      selectedLabel={selected?.label ?? (missing ? 'Unavailable project' : 'All work')}
      options={[{ value: '', label: 'All work', repoId: '' }, ...options]}
      compact
      onChange={onChange}
    />
  );
}

function RepoPicker({
  side,
  repo,
  options,
  onChange,
}: {
  side: 'a' | 'b';
  repo: ResolvedRepo;
  options: CompareRepoOption[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === repo.requested);
  const selectedLabel =
    repo.status === 'ok' ? repo.data!.project : selected?.label ?? (repo.requested || 'Pick a repo');
  const note =
    repo.status === 'unknown'
      ? 'No data for this repo in the selected range.'
      : repo.status === 'ok' && repo.ambiguous
        ? 'This old name-only link matches more than one repo. Pick the intended repo to write a stable link.'
        : null;

  return (
    <div className={styles.repoHead} role="columnheader">
      <SimpleProjectPicker
        ariaLabel={`Repo ${side.toUpperCase()}: ${selectedLabel}`}
        selectedValue={repo.requested}
        selectedLabel={selectedLabel}
        options={[{ value: '', label: 'Pick a repo', repoId: '' }, ...options]}
        menuAlign={side === 'b' ? 'end' : 'start'}
        note={note}
        onChange={onChange}
      />
    </div>
  );
}

function SimpleProjectPicker({
  ariaLabel,
  selectedValue,
  selectedLabel,
  options,
  menuAlign = 'start',
  note,
  compact = false,
  onChange,
}: {
  ariaLabel: string;
  selectedValue: string;
  selectedLabel: string;
  options: CompareRepoOption[];
  menuAlign?: 'start' | 'end';
  note?: string | null;
  compact?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const noteId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === selectedValue),
  );
  const focusSelected = useCallback(() => {
    requestAnimationFrame(() => itemRefs.current[selectedIndex]?.focus());
  }, [selectedIndex]);

  function select(value: string) {
    onChange(value);
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function onItemKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowDown') next = index + 1;
    else if (event.key === 'ArrowUp') next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    } else return;
    event.preventDefault();
    itemRefs.current[(next + options.length) % options.length]?.focus();
  }

  return (
    <div className={clsx(styles.pickerWrap, compact && styles.pickerWrapCompact)}>
      <ProjectDropdown
        width={compact ? 'auto' : 'fill'}
        triggerSize={compact ? 'sm' : 'lg'}
        menuAlign={menuAlign}
        ariaLabel={ariaLabel}
        menuAriaLabel={`${ariaLabel} options`}
        ariaDescribedBy={note ? noteId : undefined}
        open={open}
        onOpenChange={setOpen}
        onOpen={focusSelected}
        triggerRef={buttonRef}
        trigger={
          <>
            {selectedValue && (
              <ProjectDropdownSwatch
                size={compact ? 'md' : 'lg'}
                style={{ background: projectGradient(selectedValue) }}
              />
            )}
            <ProjectDropdownTriggerLabel>{selectedLabel}</ProjectDropdownTriggerLabel>
          </>
        }
      >
        {options.map((option, index) => {
          const active = selectedValue === option.value;
          return (
            <ProjectDropdownItem
              key={option.value || 'all'}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              role="menuitemradio"
              aria-checked={active}
              onClick={() => select(option.value)}
              onKeyDown={(event) => onItemKeyDown(event, index)}
            >
              {option.repoId && (
                <ProjectDropdownSwatch
                  style={{ background: projectGradient(option.repoId) }}
                />
              )}
              <ProjectDropdownItemName>{option.label}</ProjectDropdownItemName>
              <ProjectDropdownRadioCheck checked={active} />
            </ProjectDropdownItem>
          );
        })}
      </ProjectDropdown>
      {note && (
        <span id={noteId} className={styles.pickerNote}>
          {note}
        </span>
      )}
    </div>
  );
}

function parseRange(
  requested: string | null,
  allowed: readonly number[],
): RangeDays {
  const parsed = Number(requested);
  if ((parsed === 7 || parsed === 30 || parsed === 90) && allowed.includes(parsed)) {
    return parsed;
  }
  const first = allowed.find((value): value is RangeDays => value === 7 || value === 30 || value === 90);
  return first ?? 7;
}
