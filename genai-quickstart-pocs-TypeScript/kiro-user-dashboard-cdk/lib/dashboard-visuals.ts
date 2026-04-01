/**
 * QuickSight Dashboard Visual Definitions
 *
 * Exports the complete dashboard definition (sheets, visuals, filters)
 * as JSON structures compatible with the AWS CLI create-analysis / create-dashboard commands.
 *
 * 10 Sections, 25+ visuals covering:
 *   1. Overall Metrics (KPI Cards)
 *   2. Usage by Client Type
 *   3. Top 10 Users by Messages
 *   4. Daily Activity Trends
 *   5. Daily Trends by Client Type
 *   6. Credits Analysis
 *   7. Subscription Tier Breakdown
 *   8. User Engagement Analysis
 *   9. User Activity Timeline
 *  10. User Engagement Funnel
 */

// ── Column identifiers (reused across visuals) ──────────────────────────
const col = (name: string, datasetId: string) => ({
  ColumnName: name,
  DataSetIdentifier: datasetId,
});

// ── Helper: KPI visual ──────────────────────────────────────────────────
export function kpiVisual(
  id: string,
  title: string,
  fieldId: string,
  columnName: string,
  datasetId: string,
  aggregation: string,
): Record<string, any> {
  return {
    KPIVisual: {
      VisualId: id,
      Title: { Visibility: 'VISIBLE', FormatText: { PlainText: title } },
      ChartConfiguration: {
        FieldWells: {
          Values: [buildMeasureField(fieldId, columnName, datasetId, aggregation)],
        },
      },
    },
  };
}

// ── Shared: build a measure field (handles COUNT_DISTINCT vs numerical) ──
function buildMeasureField(
  fieldId: string,
  columnName: string,
  datasetId: string,
  aggregation: string,
): Record<string, any> {
  if (aggregation === 'COUNT_DISTINCT') {
    return {
      CategoricalMeasureField: {
        Column: col(columnName, datasetId),
        FieldId: fieldId,
        AggregationFunction: 'DISTINCT_COUNT',
      },
    };
  }
  return {
    NumericalMeasureField: {
      Column: col(columnName, datasetId),
      FieldId: fieldId,
      AggregationFunction: { SimpleNumericalAggregation: aggregation },
    },
  };
}

// ── Helper: Pie chart visual ────────────────────────────────────────────
export function pieChartVisual(
  id: string,
  title: string,
  categoryCol: string,
  measureCol: string,
  measureFieldId: string,
  datasetId: string,
  aggregation: string,
): Record<string, any> {
  return {
    PieChartVisual: {
      VisualId: id,
      Title: { Visibility: 'VISIBLE', FormatText: { PlainText: title } },
      ChartConfiguration: {
        FieldWells: {
          PieChartAggregatedFieldWells: {
            Category: [
              { CategoricalDimensionField: { Column: col(categoryCol, datasetId), FieldId: `${id}-cat` } },
            ],
            Values: [buildMeasureField(measureFieldId, measureCol, datasetId, aggregation)],
          },
        },
        SortConfiguration: {},
      },
    },
  };
}

// ── Helper: Bar chart visual ────────────────────────────────────────────
export function barChartVisual(
  id: string,
  title: string,
  categoryCol: string,
  measureCol: string,
  measureFieldId: string,
  datasetId: string,
  aggregation: string,
  opts?: { sortDesc?: boolean; maxItems?: number; horizontal?: boolean; colorCol?: string },
): Record<string, any> {
  const fieldWells: Record<string, any> = {
    BarChartAggregatedFieldWells: {
      Category: [
        { CategoricalDimensionField: { Column: col(categoryCol, datasetId), FieldId: `${id}-cat` } },
      ],
      Values: [buildMeasureField(measureFieldId, measureCol, datasetId, aggregation)],
    },
  };

  if (opts?.colorCol) {
    fieldWells.BarChartAggregatedFieldWells.Colors = [
      { CategoricalDimensionField: { Column: col(opts.colorCol, datasetId), FieldId: `${id}-color` } },
    ];
  }

  const sortConfig: Record<string, any> = {};
  if (opts?.sortDesc) {
    sortConfig.CategorySort = [
      { FieldSort: { FieldId: measureFieldId, Direction: 'DESC' } },
    ];
  }
  if (opts?.maxItems) {
    sortConfig.CategoryItemsLimit = { ItemsLimit: opts.maxItems, OtherCategories: 'INCLUDE' };
  }

  return {
    BarChartVisual: {
      VisualId: id,
      Title: { Visibility: 'VISIBLE', FormatText: { PlainText: title } },
      ChartConfiguration: {
        FieldWells: fieldWells,
        SortConfiguration: sortConfig,
        Orientation: opts?.horizontal ? 'HORIZONTAL' : 'VERTICAL',
      },
    },
  };
}

// ── Helper: Line chart visual ───────────────────────────────────────────
export function lineChartVisual(
  id: string,
  title: string,
  dateCol: string,
  measureCol: string,
  measureFieldId: string,
  datasetId: string,
  aggregation: string,
  opts?: { colorCol?: string },
): Record<string, any> {
  const fieldWells: Record<string, any> = {
    LineChartAggregatedFieldWells: {
      Category: [
        { CategoricalDimensionField: { Column: col(dateCol, datasetId), FieldId: `${id}-date` } },
      ],
      Values: [buildMeasureField(measureFieldId, measureCol, datasetId, aggregation)],
    },
  };

  if (opts?.colorCol) {
    fieldWells.LineChartAggregatedFieldWells.Colors = [
      { CategoricalDimensionField: { Column: col(opts.colorCol, datasetId), FieldId: `${id}-color` } },
    ];
  }

  return {
    LineChartVisual: {
      VisualId: id,
      Title: { Visibility: 'VISIBLE', FormatText: { PlainText: title } },
      ChartConfiguration: {
        FieldWells: fieldWells,
        SortConfiguration: {},
      },
    },
  };
}

// ── Helper: Pivot table visual ──────────────────────────────────────────
export function pivotTableVisual(
  id: string,
  title: string,
  rowCols: string[],
  colCols: string[],
  measureCol: string,
  measureFieldId: string,
  datasetId: string,
  aggregation: string,
): Record<string, any> {
  return {
    PivotTableVisual: {
      VisualId: id,
      Title: { Visibility: 'VISIBLE', FormatText: { PlainText: title } },
      ChartConfiguration: {
        FieldWells: {
          PivotTableAggregatedFieldWells: {
            Rows: rowCols.map((c, i) => ({
              CategoricalDimensionField: { Column: col(c, datasetId), FieldId: `${id}-row-${i}` },
            })),
            Columns: colCols.map((c, i) => ({
              CategoricalDimensionField: { Column: col(c, datasetId), FieldId: `${id}-col-${i}` },
            })),
            Values: [buildMeasureField(measureFieldId, measureCol, datasetId, aggregation)],
          },
        },
        SortConfiguration: {},
      },
    },
  };
}

// ── Helper: Table visual ────────────────────────────────────────────────
export function tableVisual(
  id: string,
  title: string,
  columns: Array<{ name: string; type: 'STRING' | 'INTEGER' | 'DECIMAL' }>,
  datasetId: string,
): Record<string, any> {
  return {
    TableVisual: {
      VisualId: id,
      Title: { Visibility: 'VISIBLE', FormatText: { PlainText: title } },
      ChartConfiguration: {
        FieldWells: {
          TableAggregatedFieldWells: {
            GroupBy: columns.map((c, i) => {
              if (c.type === 'STRING') {
                return { CategoricalDimensionField: { Column: col(c.name, datasetId), FieldId: `${id}-grp-${i}` } };
              }
              return { NumericalDimensionField: { Column: col(c.name, datasetId), FieldId: `${id}-grp-${i}` } };
            }),
            Values: [],
          },
        },
        SortConfiguration: {},
      },
    },
  };
}

// ── Helper: Funnel chart visual ─────────────────────────────────────────
export function funnelChartVisual(
  id: string,
  title: string,
  categoryCol: string,
  measureCol: string,
  measureFieldId: string,
  datasetId: string,
  aggregation: string,
): Record<string, any> {
  return {
    FunnelChartVisual: {
      VisualId: id,
      Title: { Visibility: 'VISIBLE', FormatText: { PlainText: title } },
      ChartConfiguration: {
        FieldWells: {
          FunnelChartAggregatedFieldWells: {
            Category: [
              { CategoricalDimensionField: { Column: col(categoryCol, datasetId), FieldId: `${id}-cat` } },
            ],
            Values: [buildMeasureField(measureFieldId, measureCol, datasetId, aggregation)],
          },
        },
        SortConfiguration: {},
      },
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Complete Dashboard Definition – all 10 sections
// ══════════════════════════════════════════════════════════════════════════

export function buildDashboardDefinition(datasetId: string) {
  const ds = datasetId;

  // ── Section 1: Overall Metrics (5 KPI Cards) ─────────────────────────
  const section1 = [
    kpiVisual('kpi-total-users', 'Total Users', 'f-total-users', 'userid', ds, 'COUNT_DISTINCT'),
    kpiVisual('kpi-total-messages', 'Total Messages', 'f-total-msgs', 'total_messages', ds, 'SUM'),
    kpiVisual('kpi-chat-conversations', 'Chat Conversations', 'f-total-chats', 'chat_conversations', ds, 'SUM'),
    kpiVisual('kpi-credits-used', 'Credits Used', 'f-credits', 'credits_used', ds, 'SUM'),
    kpiVisual('kpi-overage-credits', 'Overage Credits', 'f-overage', 'overage_credits_used', ds, 'SUM'),
  ];

  // ── Section 2: Usage by Client Type ──────────────────────────────────
  const section2 = [
    pieChartVisual('pie-msg-client', 'Messages by Client Type', 'client_type', 'total_messages', 'f-msg-client', ds, 'SUM'),
    barChartVisual('bar-credits-client', 'Credits by Client Type', 'client_type', 'credits_used', 'f-cred-client', ds, 'SUM'),
  ];

  // ── Section 3: Top 10 Users by Messages ──────────────────────────────
  const section3 = [
    barChartVisual('bar-top10-msgs', 'Top 10 Users by Messages', 'display_name', 'total_messages', 'f-top10-msgs', ds, 'SUM', {
      sortDesc: true,
      maxItems: 10,
      horizontal: true,
    }),
  ];

  // ── Section 4: Daily Activity Trends (4 line charts) ─────────────────
  const section4 = [
    lineChartVisual('line-daily-msgs', 'Daily Total Messages', 'date', 'total_messages', 'f-daily-msgs', ds, 'SUM'),
    lineChartVisual('line-daily-chats', 'Daily Chat Conversations', 'date', 'chat_conversations', 'f-daily-chats', ds, 'SUM'),
    lineChartVisual('line-daily-credits', 'Daily Credits Used', 'date', 'credits_used', 'f-daily-credits', ds, 'SUM'),
    lineChartVisual('line-daily-users', 'Daily Active Users', 'date', 'userid', 'f-daily-users', ds, 'COUNT_DISTINCT'),
  ];

  // ── Section 5: Daily Trends by Client Type ───────────────────────────
  const section5 = [
    lineChartVisual('line-msgs-by-client', 'Daily Messages by Client Type', 'date', 'total_messages', 'f-msgs-by-client', ds, 'SUM', { colorCol: 'client_type' }),
    lineChartVisual('line-chats-by-client', 'Daily Conversations by Client Type', 'date', 'chat_conversations', 'f-chats-by-client', ds, 'SUM', { colorCol: 'client_type' }),
  ];

  // ── Section 6: Credits Analysis ──────────────────────────────────────
  const section6 = [
    barChartVisual('bar-top15-credits', 'Top 15 Users by Total Credits', 'display_name', 'total_credits', 'f-top15-cred', ds, 'SUM', {
      sortDesc: true,
      maxItems: 15,
      horizontal: true,
    }),
    pieChartVisual('pie-base-vs-overage', 'Base vs Overage Credits', 'subscription_tier', 'credits_used', 'f-base-cred', ds, 'SUM'),
    pivotTableVisual('pivot-credits-user-month', 'Credits by User by Month', ['display_name'], ['date'], 'credits_used', 'f-pivot-cred', ds, 'SUM'),
  ];

  // ── Section 7: Subscription Tier Breakdown ───────────────────────────
  const section7 = [
    barChartVisual('bar-users-tier', 'Users by Subscription Tier', 'subscription_tier', 'userid', 'f-users-tier', ds, 'COUNT_DISTINCT'),
    barChartVisual('bar-credits-tier', 'Credits by Subscription Tier', 'subscription_tier', 'credits_used', 'f-credits-tier', ds, 'SUM'),
  ];

  // ── Section 8: User Engagement Analysis ──────────────────────────────
  const section8 = [
    pieChartVisual('pie-engagement', 'User Distribution by Engagement Level', 'engagement_level', 'userid', 'f-engage-dist', ds, 'COUNT_DISTINCT'),
    kpiVisual('kpi-power-users', 'Power Users', 'f-power', 'userid', ds, 'COUNT_DISTINCT'),
    kpiVisual('kpi-active-users', 'Active Users', 'f-active', 'userid', ds, 'COUNT_DISTINCT'),
    kpiVisual('kpi-light-users', 'Light Users', 'f-light', 'userid', ds, 'COUNT_DISTINCT'),
    kpiVisual('kpi-idle-users', 'Idle Users', 'f-idle', 'userid', ds, 'COUNT_DISTINCT'),
  ];

  // ── Section 9: User Activity Timeline ────────────────────────────────
  const section9 = [
    barChartVisual('bar-days-since', 'Days Since Last Activity - Top 15', 'display_name', 'days_since_last_activity', 'f-days-since', ds, 'MIN', {
      sortDesc: true,
      maxItems: 15,
      horizontal: true,
    }),
    barChartVisual('bar-active-days', 'Total Active Days - Top 15', 'display_name', 'date', 'f-active-days', ds, 'COUNT_DISTINCT', {
      sortDesc: true,
      maxItems: 15,
      horizontal: true,
    }),
    tableVisual('tbl-user-activity', 'User Activity Details', [
      { name: 'display_name', type: 'STRING' },
      { name: 'date', type: 'STRING' },
      { name: 'engagement_level', type: 'STRING' },
      { name: 'client_type', type: 'STRING' },
      { name: 'subscription_tier', type: 'STRING' },
    ], ds),
  ];

  // ── Section 10: User Engagement Funnel ───────────────────────────────
  const section10 = [
    funnelChartVisual('funnel-engagement', 'User Engagement Funnel', 'engagement_level', 'userid', 'f-funnel', ds, 'COUNT_DISTINCT'),
  ];

  // ── Assemble all visuals into a flat list ────────────────────────────
  const allVisuals = [
    ...section1,
    ...section2,
    ...section3,
    ...section4,
    ...section5,
    ...section6,
    ...section7,
    ...section8,
    ...section9,
    ...section10,
  ];

  // ── Sheet definition ─────────────────────────────────────────────────
  return {
    DataSetIdentifierDeclarations: [
      { Identifier: ds, DataSetArn: `PLACEHOLDER_DATASET_ARN` },
    ],
    Sheets: [
      {
        SheetId: 'kiro-dashboard-sheet-1',
        Name: 'Kiro User Dashboard',
        Visuals: allVisuals,
        FilterControls: [],
      },
    ],
    FilterGroups: [
      {
        FilterGroupId: 'fg-client-type',
        Filters: [
          {
            CategoryFilter: {
              FilterId: 'filter-client-type',
              Column: col('client_type', ds),
              Configuration: {
                FilterListConfiguration: {
                  MatchOperator: 'CONTAINS',
                  NullOption: 'NON_NULLS_ONLY',
                },
              },
            },
          },
        ],
        ScopeConfiguration: { AllSheets: {} },
        CrossDataset: 'ALL_DATASETS',
      },
    ],
    CalculatedFields: [],
    ColumnConfigurations: [],
  };
}
