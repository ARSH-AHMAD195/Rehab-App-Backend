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
 * Patients are kept out for now: the SRS says they must only ever see the
 * exercises in their own plan, never the library. Their view comes with plans.
 */
@ApiTags('Exercise library')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE' })
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  @Roles(ROLES.ADMIN, ROLES.DOCTOR)
  @ApiOperation({ summary: 'The library, A to Z (admin, doctor)' })
  @ApiOkResponse({ type: ExerciseListResponse })
  list(@Query() query: ListExercisesQueryDto): Promise<ExerciseListResponse> {
    return this.exercises.list(query);
  }

  @Get(':exerciseId')
  @Roles(ROLES.ADMIN, ROLES.DOCTOR)
  @ApiOperation({ summary: 'One exercise, active or not (admin, doctor)' })
  @ApiOkResponse({ type: ExerciseResponse })
  @ApiNotFoundResponse({ description: 'NOT_FOUND' })
  get(@Param('exerciseId') id: string): Promise<ExerciseResponse> {
    return this.exercises.get(id);
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
}
