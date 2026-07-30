import {
  openAppDatabase,
  type AppDatabaseHandle
} from "@bread-map/app-db";

let appDatabase: AppDatabaseHandle | undefined;

export function getAppDatabase(): AppDatabaseHandle {
  appDatabase ??= openAppDatabase();

  return appDatabase;
}
