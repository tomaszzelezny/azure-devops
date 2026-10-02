import * as SDK from "azure-devops-extension-sdk";

interface IWorkItemFormNavigationService {
  openWorkItem(workItemId: number, openInNewTab?: boolean): Promise<unknown>;
}

export async function openWorkItem(id: number): Promise<void> {
  const nav = await SDK.getService<IWorkItemFormNavigationService>("ms.vss-work-web.work-item-form-navigation-service");
  await nav.openWorkItem(id);
}
