/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */

export interface paths {
  '/': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Return the OpenAPI schema in JSON format. */
    get: operations['api_get_schema']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/machines': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List available machines and their statuses */
    get: operations['get_machines']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/machines/{id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get the status of a specific machine */
    get: operations['get_machine']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/metrics': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List available machines and their statuses */
    get: operations['get_metrics']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/ping': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Return pong. */
    get: operations['ping']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/print': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Print a given file. File must be a sliceable 3D model. */
    post: operations['print_file']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
}
export type webhooks = Record<string, never>
export interface components {
  schemas: {
    /** @description Error information from a response. */
    Error: {
      error_code?: string
      message: string
      request_id: string
    }
    /** @description Extra machine-specific information regarding a connected machine. */
    ExtraMachineInfoResponse:
      | {
          /** @enum {string} */
          type: 'moonraker'
        }
      | {
          /** @enum {string} */
          type: 'usb'
        }
      | {
          /** @description The current stage of the machine as defined by Bambu which can include errors, etc. */
          current_stage?: components['schemas']['Stage'] | null
          /** @description The nozzle diameter of the machine. */
          nozzle_diameter: components['schemas']['NozzleDiameter']
          /** @enum {string} */
          type: 'bambu'
        }
    /** @description Configuration for a FDM-based printer. */
    FdmHardwareConfiguration: {
      /** @description The filaments the printer has access to. */
      filaments: components['schemas']['Filament'][]
      /**
       * Format: uint
       * @description The currently loaded filament index.
       */
      loaded_filament_idx?: number | null
      /**
       * Format: double
       * @description Diameter of the extrusion nozzle, in mm.
       */
      nozzle_diameter: number
    }
    /** @description Information about the filament being used in a FDM printer. */
    Filament: {
      /** @description The color (as hex without the `#`) of the filament, this is likely specific to the manufacturer. */
      color?: string | null
      /** @description The material that the filament is made of. */
      material: components['schemas']['FilamentMaterial']
      /** @description The name of the filament, this is likely specific to the manufacturer. */
      name?: string | null
    }
    /** @description The material that the filament is made of. */
    FilamentMaterial:
      | {
          /** @enum {string} */
          type: 'pla'
        }
      | {
          /** @enum {string} */
          type: 'pla_support'
        }
      | {
          /** @enum {string} */
          type: 'abs'
        }
      | {
          /** @enum {string} */
          type: 'petg'
        }
      | {
          /** @enum {string} */
          type: 'nylon'
        }
      | {
          /** @enum {string} */
          type: 'tpu'
        }
      | {
          /** @enum {string} */
          type: 'pva'
        }
      | {
          /** @enum {string} */
          type: 'hips'
        }
      | {
          /** @enum {string} */
          type: 'composite'
        }
      | {
          /** @enum {string} */
          type: 'unknown'
        }
    /** @description The hardware configuration of a machine. */
    HardwareConfiguration:
      | {
          /** @enum {string} */
          type: 'none'
        }
      | {
          /** @description The configuration for the FDM printer. */
          config: components['schemas']['FdmHardwareConfiguration']
          /** @enum {string} */
          type: 'fdm'
        }
    /** @description Information regarding a connected machine. */
    MachineInfoResponse: {
      /** @description Additional, per-machine information which is specific to the underlying machine type. */
      extra?: components['schemas']['ExtraMachineInfoResponse'] | null
      /** @description Information about how the Machine is currently configured. */
      hardware_configuration: components['schemas']['HardwareConfiguration']
      /** @description Machine Identifier (ID) for the specific Machine. */
      id: string
      /** @description Information regarding the method of manufacture. */
      machine_type: components['schemas']['MachineType']
      /** @description Information regarding the make and model of the attached Machine. */
      make_model: components['schemas']['MachineMakeModel']
      /** @description Maximum part size that can be manufactured by this device. This may be some sort of theoretical upper bound, getting close to this limit seems like maybe a bad idea.
       *
       *     This may be `None` if the maximum size is not knowable by the Machine API.
       *
       *     What "close" means is up to you! */
      max_part_volume?: components['schemas']['Volume'] | null
      /**
       * Format: double
       * @description Progress of the current print, if printing.
       */
      progress?: number | null
      /** @description Status of the printer -- be it printing, idle, or unreachable. This may dictate if a machine is capable of taking a new job. */
      state: components['schemas']['MachineState']
    }
    /** @description Information regarding the make/model of a discovered endpoint. */
    MachineMakeModel: {
      /** @description The manufacturer that built the connected Machine. */
      manufacturer?: string | null
      /** @description The model of the connected Machine. */
      model?: string | null
      /** @description The unique serial number of the connected Machine. */
      serial?: string | null
    }
    /** @description Current state of the machine -- be it printing, idle or offline. This can be used to determine if a printer is in the correct state to take a new job. */
    MachineState:
      | {
          /** @enum {string} */
          state: 'unknown'
        }
      | {
          /** @enum {string} */
          state: 'idle'
        }
      | {
          /** @enum {string} */
          state: 'running'
        }
      | {
          /** @enum {string} */
          state: 'offline'
        }
      | {
          /** @enum {string} */
          state: 'paused'
        }
      | {
          /** @enum {string} */
          state: 'complete'
        }
      | {
          /** @description A human-readable message describing the failure. */
          message?: string | null
          /** @enum {string} */
          state: 'failed'
        }
    /** @description Specific technique by which this Machine takes a design, and produces a real-world 3D object. */
    MachineType: 'stereolithography' | 'fused_deposition' | 'cnc'
    /** @description A nozzle diameter. */
    NozzleDiameter: '0.2' | '0.4' | '0.6' | '0.8'
    /** @description The response from the `/ping` endpoint. */
    Pong: {
      /** @description The pong response. */
      message: string
    }
    /** @description The response from the `/print` endpoint. */
    PrintJobResponse: {
      /** @description The job id used for this print. */
      job_id: string
      /** @description The parameters used for this print. */
      parameters: components['schemas']['PrintParameters']
    }
    /** @description Parameters for printing. */
    PrintParameters: {
      /** @description The name for the job. */
      job_name: string
      /** @description The machine id to print to. */
      machine_id: string
      /** @description Requested design-specific slicer configurations. */
      slicer_configuration?: components['schemas']['SlicerConfiguration'] | null
    }
    /** @description The slicer configuration is a set of parameters that are passed to the slicer to control how the gcode is generated. */
    SlicerConfiguration: {
      /**
       * Format: uint
       * @description The filament to use for the print.
       */
      filament_idx?: number | null
    }
    /** @description The print stage. These come from: https://github.com/SoftFever/OrcaSlicer/blob/431978baf17961df90f0d01871b0ad1d839d7f5d/src/slic3r/GUI/DeviceManager.cpp#L78 */
    Stage:
      | 'nothing'
      | 'empty'
      | 'auto_bed_leveling'
      | 'heatbed_preheating'
      | 'sweeping_xy_mech_mode'
      | 'changing_filament'
      | 'm400_pause'
      | 'paused_due_to_filament_runout'
      | 'heating_hotend'
      | 'calibrating_extrusion'
      | 'scanning_bed_surface'
      | 'inspecting_first_layer'
      | 'identifying_build_plate_type'
      | 'calibrating_micro_lidar'
      | 'homing_toolhead'
      | 'cleaning_nozzle_tip'
      | 'checking_extruder_temperature'
      | 'printing_was_paused_by_the_user'
      | 'pause_of_front_cover_falling'
      | 'calibrating_micro_lidar2'
      | 'calibrating_extrusion_flow'
      | 'paused_due_to_nozzle_temperature_malfunction'
      | 'paused_due_to_heat_bed_temperature_malfunction'
      | 'filament_unloading'
      | 'skip_step_pause'
      | 'filament_loading'
      | 'motor_noise_calibration'
      | 'paused_due_to_ams_lost'
      | 'paused_due_to_low_speed_of_the_heat_break_fan'
      | 'paused_due_to_chamber_temperature_control_error'
      | 'cooling_chamber'
      | 'paused_by_the_gcode_inserted_by_the_user'
      | 'motor_noise_showoff'
      | 'nozzle_filament_covered_detected_pause'
      | 'cutter_error_pause'
      | 'first_layer_error_pause'
      | 'nozzle_clog_pause'
    /** @description Set of three values to represent the extent of a 3-D Volume. This contains the width, depth, and height values, generally used to represent some maximum or minimum.
     *
     *     All measurements are in millimeters. */
    Volume: {
      /**
       * Format: double
       * @description Depth of the volume ("front to back"), in millimeters.
       */
      depth: number
      /**
       * Format: double
       * @description Height of the volume ("up and down"), in millimeters.
       */
      height: number
      /**
       * Format: double
       * @description Width of the volume ("left and right"), in millimeters.
       */
      width: number
    }
  }
  responses: {
    /** @description Error */
    Error: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/json': components['schemas']['Error']
      }
    }
  }
  parameters: never
  requestBodies: never
  headers: never
  pathItems: never
}
export type $defs = Record<string, never>
export interface operations {
  api_get_schema: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description successful operation */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': unknown
        }
      }
      '4XX': components['responses']['Error']
      '5XX': components['responses']['Error']
    }
  }
  get_machines: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description successful operation */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MachineInfoResponse'][]
        }
      }
      '4XX': components['responses']['Error']
      '5XX': components['responses']['Error']
    }
  }
  get_machine: {
    parameters: {
      query?: never
      header?: never
      path: {
        /** @description The machine ID. */
        id: string
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description successful operation */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MachineInfoResponse']
        }
      }
      '4XX': components['responses']['Error']
      '5XX': components['responses']['Error']
    }
  }
  get_metrics: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description successful operation */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': string
        }
      }
      '4XX': components['responses']['Error']
      '5XX': components['responses']['Error']
    }
  }
  ping: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description successful operation */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Pong']
        }
      }
      '4XX': components['responses']['Error']
      '5XX': components['responses']['Error']
    }
  }
  print_file: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': string
      }
    }
    responses: {
      /** @description successful operation */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PrintJobResponse']
        }
      }
      '4XX': components['responses']['Error']
      '5XX': components['responses']['Error']
    }
  }
}
