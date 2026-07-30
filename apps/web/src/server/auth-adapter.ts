import type {
  Adapter,
  AdapterAccount,
  AdapterUser
} from "@auth/core/adapters";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import {
  accounts,
  users,
  type AppDatabaseHandle
} from "@bread-map/app-db";

type AppDatabase = AppDatabaseHandle["db"];

const KAKAO_PROVIDER = "kakao";
const OAUTH_ACCOUNT_TYPE = "oauth";

function toMinimalUser(user: { id: string }): AdapterUser {
  return {
    id: user.id,
    name: null,
    email: null as unknown as string,
    emailVerified: null,
    image: null
  };
}

function toMinimalAccount(account: {
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
}): AdapterAccount {
  return {
    userId: account.userId,
    type: OAUTH_ACCOUNT_TYPE,
    provider: KAKAO_PROVIDER,
    providerAccountId: account.providerAccountId
  };
}

function assertKakaoAccount(account: {
  type?: string;
  provider: string;
}): void {
  if (
    account.provider !== KAKAO_PROVIDER ||
    (account.type !== undefined &&
      account.type !== OAUTH_ACCOUNT_TYPE)
  ) {
    throw new Error("unsupported auth provider");
  }
}

export function createMinimalAuthAdapter(
  database: AppDatabase
): Adapter {
  const adapter = DrizzleAdapter(
    database,
    {
      usersTable: users,
      accountsTable: accounts
    } as never
  );

  return {
    async createUser(user) {
      const created = await adapter.createUser!(user);

      return toMinimalUser(created);
    },
    async getUser(userId) {
      const user = await adapter.getUser!(userId);

      return user === null ? null : toMinimalUser(user);
    },
    async getUserByEmail() {
      return null;
    },
    async getUserByAccount(account) {
      assertKakaoAccount(account);
      const user = await adapter.getUserByAccount!(account);

      return user === null ? null : toMinimalUser(user);
    },
    async updateUser(user) {
      const existing = await adapter.getUser!(user.id);

      if (existing === null) {
        throw new Error("user not found");
      }

      return toMinimalUser(existing);
    },
    async deleteUser(userId) {
      await adapter.deleteUser!(userId);
    },
    async linkAccount(account) {
      assertKakaoAccount(account);
      await adapter.linkAccount!({
        userId: account.userId,
        type: OAUTH_ACCOUNT_TYPE,
        provider: KAKAO_PROVIDER,
        providerAccountId: account.providerAccountId
      });
    },
    async unlinkAccount(account) {
      assertKakaoAccount(account);
      await adapter.unlinkAccount!(account);
    },
    async getAccount(providerAccountId, provider) {
      if (provider !== KAKAO_PROVIDER) {
        return null;
      }

      const account = await adapter.getAccount!(
        providerAccountId,
        provider
      );

      return account === null ? null : toMinimalAccount(account);
    }
  };
}

export function createLazyMinimalAuthAdapter(
  getDatabase: () => AppDatabase
): Adapter {
  return {
    createUser(user) {
      return createMinimalAuthAdapter(getDatabase()).createUser!(user);
    },
    getUser(userId) {
      return createMinimalAuthAdapter(getDatabase()).getUser!(userId);
    },
    getUserByEmail(email) {
      return createMinimalAuthAdapter(
        getDatabase()
      ).getUserByEmail!(email);
    },
    getUserByAccount(account) {
      return createMinimalAuthAdapter(
        getDatabase()
      ).getUserByAccount!(account);
    },
    updateUser(user) {
      return createMinimalAuthAdapter(getDatabase()).updateUser!(user);
    },
    deleteUser(userId) {
      return createMinimalAuthAdapter(getDatabase()).deleteUser!(
        userId
      );
    },
    linkAccount(account) {
      return createMinimalAuthAdapter(getDatabase()).linkAccount!(
        account
      );
    },
    unlinkAccount(account) {
      return createMinimalAuthAdapter(getDatabase()).unlinkAccount!(
        account
      );
    },
    getAccount(providerAccountId, provider) {
      return createMinimalAuthAdapter(getDatabase()).getAccount!(
        providerAccountId,
        provider
      );
    }
  };
}
