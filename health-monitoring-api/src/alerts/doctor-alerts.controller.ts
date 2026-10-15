import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ROLES } from '../common/constants';
import { NotFoundException } from '../common/api.exception';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser, UsersService } from '../users/users.service';
import { AlertsQueryDto } from '../daily-logs/dto';
import { AlertsService } from './alerts.service';
import { AcknowledgeAlertDto } from './acknowledge-alert.dto';
import { AlertListResponse, AlertResponse } from './alert.response';

@ApiTags('Doctor alerts')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR)
@Controller('doctor/alerts')
export class DoctorAlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Alerts across the doctor's patients",
    description: 'Newest first. Defaults to status=OPEN.',
  })
  @ApiOkResponse({ type: AlertListResponse })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - patientId filter is not a linked patient' })
  async list(
    @CurrentUser() doctor: AuthUser,
    @Query() query: AlertsQueryDto,
  ): Promise<AlertListResponse> {
    // "patientId - Filter to one patient. 404 if not linked" (v1.1).
    if (query.patientId && !(await this.users.isPatientLinkedToDoctor(query.patientId, doctor.id))) {
      throw new NotFoundException('Patient not found');
    }
    return this.alerts.listForDoctor(doctor, query);
  }

  @Patch(':alertId')
  @ApiOperation({
    summary: 'Acknowledge an alert',
    description:
      'ACKNOWLEDGED is final - alerts never reopen - and the note is set once and cannot be ' +
      'edited afterwards. Any doctor linked to the patient may acknowledge.',
  })
  @ApiOkResponse({ type: AlertResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED - any status other than ACKNOWLEDGED' })
  @ApiNotFoundResponse({
    description: "NOT_FOUND - unknown alert, or its patient isn't linked to this doctor",
  })
  @ApiConflictResponse({ description: 'ALERT_ALREADY_ACKNOWLEDGED' })
  async acknowledge(
    @CurrentUser() doctor: AuthUser,
    @Param('alertId') alertId: string,
    @Body() body: AcknowledgeAlertDto,
  ): Promise<AlertResponse> {
    return this.alerts.acknowledge(alertId, body, doctor);
  }
}
