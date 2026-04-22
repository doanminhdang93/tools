export interface ColumnConfig {
  notionProperty: string;
  sheetHeader: string;
}

export const columns: ColumnConfig[] = [
  { notionProperty: "Task ID", sheetHeader: "Task ID" },
  { notionProperty: "product", sheetHeader: "Task" },
  { notionProperty: "Status", sheetHeader: "Status" },
  { notionProperty: "Assignee", sheetHeader: "Assignee" },
  { notionProperty: "Follower", sheetHeader: "Follower" },
  { notionProperty: "Size Card", sheetHeader: "Size Card" },
  { notionProperty: "Sprint", sheetHeader: "Sprint" },
  { notionProperty: "Created time", sheetHeader: "Created time" },
];
