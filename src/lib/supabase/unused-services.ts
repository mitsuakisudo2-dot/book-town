// supabase-js makes a Realtime, a Storage and a Functions client beside the
// ones for login (auth-js) and the tables (postgrest-js), and every page read
// them: about 100KB of its 222KB (minified; 28KB of 58KB compressed). This
// app uses none of them (AUD-045). The build reads this file in their place
// (next.config.ts), so the client still makes them and they do nothing; one
// that is asked to do something says so. tests/unused-services.test.ts
// checks it names everything supabase-js takes from them.

const unused = (what: string) =>
  new Error(`This app has no Supabase ${what} (unused-services.ts).`);

/** In place of realtime-js's: told the login's token, and keeps nothing. */
export class RealtimeClient {
  setAuth(): Promise<void> {
    return Promise.resolve();
  }
  getChannels(): [] {
    return [];
  }
  channel(): never {
    throw unused("Realtime");
  }
  removeChannel(): Promise<"ok"> {
    return Promise.resolve("ok");
  }
  removeAllChannels(): Promise<[]> {
    return Promise.resolve([]);
  }
}

/** In place of storage-js's: made with the client, never asked. */
export class StorageClient {
  from(): never {
    throw unused("Storage");
  }
}

/** In place of functions-js's: made only when asked, so never. */
export class FunctionsClient {
  constructor() {
    throw unused("Functions");
  }
}

export class StorageApiError extends Error {}
export class FunctionsError extends Error {}
export class FunctionsFetchError extends FunctionsError {}
export class FunctionsHttpError extends FunctionsError {}
export class FunctionsRelayError extends FunctionsError {}
export const FunctionRegion = {};
