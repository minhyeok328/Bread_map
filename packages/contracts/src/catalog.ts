import { z } from "zod";

const nullableSourceTextSchema = z.string().nullable();

const sourcePageNumberSchema = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform((value) => Number(value))
  .pipe(z.number().int().positive());

const sourceCountSchema = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform((value) => Number(value))
  .pipe(z.number().int().nonnegative());

const localdataProviderRowSchema = z
  .object({
    OPN_ATMY_GRP_CD: z.string().min(1),
    MNG_NO: z.string().min(1),
    LCPMT_YMD: nullableSourceTextSchema,
    SALS_STTS_CD: z.string().min(1),
    SALS_STTS_NM: z.string().min(1),
    DTL_SALS_STTS_CD: nullableSourceTextSchema,
    DTL_SALS_STTS_NM: nullableSourceTextSchema,
    CLSBIZ_YMD: nullableSourceTextSchema,
    BPLC_NM: z.string().min(1),
    ROAD_NM_ADDR: nullableSourceTextSchema,
    LOTNO_ADDR: nullableSourceTextSchema,
    CRD_INFO_X: nullableSourceTextSchema,
    CRD_INFO_Y: nullableSourceTextSchema,
    DAT_UPDT_PNT: nullableSourceTextSchema,
    LAST_MDFCN_PNT: nullableSourceTextSchema
  })
  .transform((row) => ({
    openAuthorityGroupCode: row.OPN_ATMY_GRP_CD,
    managementNumber: row.MNG_NO,
    permitDate: row.LCPMT_YMD,
    businessStatusCode: row.SALS_STTS_CD,
    businessStatusName: row.SALS_STTS_NM,
    detailedBusinessStatusCode: row.DTL_SALS_STTS_CD,
    detailedBusinessStatusName: row.DTL_SALS_STTS_NM,
    closedDate: row.CLSBIZ_YMD,
    businessName: row.BPLC_NM,
    roadNameAddress: row.ROAD_NM_ADDR,
    lotNumberAddress: row.LOTNO_ADDR,
    coordinateX: row.CRD_INFO_X,
    coordinateY: row.CRD_INFO_Y,
    dataUpdatedAt: row.DAT_UPDT_PNT,
    lastModifiedAt: row.LAST_MDFCN_PNT
  }));

export const localdataSourceRowSchema = localdataProviderRowSchema;

const localdataItemsSchema = z
  .union([
    z.array(localdataProviderRowSchema),
    z.object({ item: z.array(localdataProviderRowSchema) })
  ])
  .transform((value) => (Array.isArray(value) ? value : value.item));

export const localdataPageResponseSchema = z
  .object({
    response: z.object({
      header: z.object({
        resultCode: z.literal("00"),
        resultMsg: z.string()
      }),
      body: z.object({
        pageNo: sourcePageNumberSchema,
        numOfRows: sourcePageNumberSchema,
        totalCount: sourceCountSchema,
        items: localdataItemsSchema
      })
    })
  })
  .transform(({ response }) => ({
    pageNo: response.body.pageNo,
    numOfRows: response.body.numOfRows,
    totalCount: response.body.totalCount,
    items: response.body.items
  }));

export type LocaldataSourceRow = z.output<
  typeof localdataSourceRowSchema
>;
export type LocaldataPage = z.output<
  typeof localdataPageResponseSchema
>;

export const ingestionSummarySchema = z.object({
  runId: z.string().min(1),
  sourceId: z.string().min(1),
  snapshotId: z.string().min(1),
  status: z.literal("SUCCEEDED"),
  pageCount: z.number().int().nonnegative(),
  readCount: z.number().int().nonnegative(),
  insertedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative()
});

export type IngestionSummary = z.output<
  typeof ingestionSummarySchema
>;
