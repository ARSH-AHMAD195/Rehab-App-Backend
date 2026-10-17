import { ApiProperty } from '@nestjs/swagger';

/** An entry of GET /doctor/alerts `data[]` (v1.1). */
export class AlertResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: { id: '6701f0a9e4b0f1a2b3c4d001', name: 'Rajesh Iyer' } })
  patient!: { id: string; name: string };
  @ApiProperty({ example: '2026-10-09' }) date!: string;
  @ApiProperty({ example: 'PAIN' }) type!: string;
  @ApiProperty({ nullable: true, example: null }) field!: string | null;

  @ApiProperty({ description: 'The reading that crossed the limit.', example: { num: 7 } })
  value!: Record<string, unknown>;

  @ApiProperty({
    nullable: true,
    description: "That parameter's value in the log now, which may differ after the patient edits it.",
    example: { num: 7 },
  })
  currentValue!: Record<string, unknown> | null;

  @ApiProperty({ enum: ['BELOW_LOW', 'ABOVE_HIGH'] }) rule!: string;
  @ApiProperty({ example: 6 }) threshold!: number;
  @ApiProperty() thresholdId!: string;
  @ApiProperty({ example: 1 }) thresholdVersion!: number;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'] }) severity!: string;
  @ApiProperty({ enum: ['OPEN', 'ACKNOWLEDGED'] }) status!: string;
  @ApiProperty({ example: '2026-10-09T15:03:02+05:30' }) createdAt!: string;
  @ApiProperty({ example: '2026-10-09T15:03:02+05:30' }) updatedAt!: string;
  @ApiProperty({ nullable: true }) acknowledgedBy!: string | null;
  @ApiProperty({ nullable: true }) acknowledgedAt!: string | null;
  @ApiProperty({ nullable: true }) note!: string | null;
}

/** The compact alert shape returned by PUT /me/vitals/today. */
export class SaveAlertResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PAIN' }) type!: string;
  @ApiProperty({ nullable: true }) field!: string | null;
  @ApiProperty({ enum: ['BELOW_LOW', 'ABOVE_HIGH'] }) rule!: string;
  @ApiProperty({ example: 6 }) threshold!: number;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'] }) severity!: string;
  @ApiProperty({ enum: ['OPEN', 'ACKNOWLEDGED'] }) status!: string;
}

export class AlertListResponse {
  @ApiProperty({ type: [AlertResponse] }) data!: AlertResponse[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
}
