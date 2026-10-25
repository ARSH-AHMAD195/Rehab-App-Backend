import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../users/users.service';
import { ExercisesService } from './exercises.service';
import {
  CreateExerciseDto,
  ExerciseListResponse,
  ExerciseResponse,
  ListExercisesQueryDto,
  UpdateExerciseDto,
} from './exercise.dto';

/**
 * The exercise library.
 *
 * SRS: "Do not expose the full exercise library to patients as a substitute
 * for doctor assignment." A patient gets the same routes, limited to the
 * exercises in their own current plan.
 */
@ApiTags('Exercise library')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE' })
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  @ApiOperation({ summary: 'The library, A to Z. A patient sees only the exercises in their plan' })
  @ApiOkResponse({ type: ExerciseListResponse })
  async list(@CurrentUser() caller: AuthUser, @Query() query: ListExercisesQueryDto): Promise<ExerciseListResponse> {
    return this.exercises.list(query, await this.planOnly(caller));
  }

  @Get(':exerciseId')
  @ApiOperation({ summary: 'One exercise, active or not. A patient gets 404 unless it is in their plan' })
  @ApiOkResponse({ type: ExerciseResponse })
  @ApiNotFoundResponse({ description: 'NOT_FOUND' })
  async get(@CurrentUser() caller: AuthUser, @Param('exerciseId') id: string): Promise<ExerciseResponse> {
    return this.exercises.get(id, await this.planOnly(caller));
  }

  @Post()
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Add an exercise (admin)' })
  @ApiCreatedResponse({ type: ExerciseResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED - e.g. an unknown or deactivated category, or a link that is not YouTube' })
  create(@CurrentUser() admin: AuthUser, @Body() body: CreateExerciseDto): Promise<ExerciseResponse> {
    return this.exercises.create(body, admin);
  }

  @Patch(':exerciseId')
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Change an exercise, including its video (admin)' })
  @ApiOkResponse({ type: ExerciseResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND' })
  update(
    @CurrentUser() admin: AuthUser,
    @Param('exerciseId') id: string,
    @Body() body: UpdateExerciseDto,
  ): Promise<ExerciseResponse> {
    return this.exercises.update(id, body, admin);
  }

  @Delete(':exerciseId')
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Deactivate an exercise (admin)', description: 'Exercises are never removed.' })
  @ApiOkResponse({ type: ExerciseResponse })
  @ApiNotFoundResponse({ description: 'NOT_FOUND' })
  deactivate(@CurrentUser() admin: AuthUser, @Param('exerciseId') id: string): Promise<ExerciseResponse> {
    return this.exercises.deactivate(id, admin);
  }

  /** For a patient, the exercises they may see; for anyone else, no limit. */
  private async planOnly(caller: AuthUser): Promise<Types.ObjectId[] | undefined> {
    return caller.role === ROLES.PATIENT ? this.exercises.currentPlanExerciseIds(caller.id) : undefined;
  }
}
